import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SerialPort } from 'serialport';
import { ModemConfigService } from '../config/modem-config.service';
import { MODEM_STATUS_EVENT } from '../common/events/app.events';
import type { ModemStatusPayload } from '../common/events/app.events';
import { normalizePhone } from '../common/utils/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AtCommandService } from './at-command.service';
import { ModemInstance } from './modem.instance';
import { ModemRuntimeState } from './modem.types';
import { SimInboxParser } from './sim-inbox.parser';
import { SmsParser } from './sms.parser';

@Injectable()
export class ModemManager implements OnModuleInit, OnModuleDestroy {
  private instances = new Map<string, ModemInstance>();
  private discoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly modemConfigService: ModemConfigService,
    private readonly atCommandService: AtCommandService,
    private readonly smsParser: SmsParser,
    private readonly simInboxParser: SimInboxParser,
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ModemManager.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncConfiguredPorts();
    this.startDiscoveryLoop();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }

    await Promise.all(
      [...this.instances.values()].map((instance) => instance.stop()),
    );
    this.instances.clear();
  }

  getAllStates(): ModemRuntimeState[] {
    return this.modemConfigService
      .getEntries()
      .map((entry) => this.buildStateForPort(entry.port))
      .sort((a, b) =>
        a.port.localeCompare(b.port, undefined, { numeric: true }),
      );
  }

  getState(port: string): ModemRuntimeState | null {
    if (!this.modemConfigService.getEntry(port)) {
      return null;
    }
    return this.buildStateForPort(port);
  }

  getFleetSummary(): {
    total: number;
    online: number;
    offline: number;
    connecting: number;
    noSim: number;
    disabled: number;
  } {
    const states = this.getAllStates();
    return {
      total: states.length,
      online: states.filter((s) => s.status === 'online').length,
      offline: states.filter((s) => s.status === 'offline').length,
      connecting: states.filter((s) => s.status === 'connecting').length,
      noSim: states.filter((s) => s.status === 'no_sim').length,
      disabled: states.filter((s) => s.status === 'disabled').length,
    };
  }

  async updatePortEnabled(
    port: string,
    enabled: boolean,
  ): Promise<ModemRuntimeState> {
    const normalizedPort = port.trim().toUpperCase();
    const entry = this.modemConfigService.getEntry(normalizedPort);
    if (!entry) {
      throw new Error(`Unknown COM port: ${normalizedPort}`);
    }

    this.modemConfigService.updateEntryEnabled(normalizedPort, enabled);

    const instance = this.instances.get(normalizedPort);
    if (!enabled) {
      if (instance) {
        await instance.stop();
        this.instances.delete(normalizedPort);
      }
    } else {
      const config = this.modemConfigService.getConfig();
      const listedPaths = config.autoDiscover
        ? new Set((await SerialPort.list()).map((item) => item.path))
        : null;

      if (
        !this.instances.has(normalizedPort) &&
        (!listedPaths || listedPaths.has(normalizedPort))
      ) {
        await this.startInstance(normalizedPort);
      }
    }

    const state = this.buildStateForPort(normalizedPort);
    this.eventEmitter.emit(MODEM_STATUS_EVENT, state);
    return state;
  }

  updatePortPhone(port: string, phone: string): ModemRuntimeState {
    const normalizedPort = port.trim().toUpperCase();
    const entry = this.modemConfigService.getEntry(normalizedPort);
    if (!entry) {
      throw new Error(`Unknown COM port: ${normalizedPort}`);
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw new Error('Invalid phone number');
    }

    this.modemConfigService.updateEntryPhone(normalizedPort, normalizedPhone);

    const instance = this.instances.get(normalizedPort);
    if (instance) {
      instance.applyPhoneOverride(normalizedPhone);
    } else {
      const state = this.buildStateForPort(normalizedPort);
      this.eventEmitter.emit(MODEM_STATUS_EVENT, state);
    }

    return this.buildStateForPort(normalizedPort);
  }

  async sendSms(
    port: string,
    phone: string,
    message: string,
  ): Promise<{ port: string; phone: string; reference: number }> {
    const entry = this.modemConfigService.getEntry(port);
    if (!entry) {
      throw new Error(`Unknown COM port: ${port}`);
    }

    const instance = this.instances.get(port);
    if (!instance) {
      throw new Error(`Modem ${port} is not connected`);
    }

    const reference = await instance.sendSms(phone, message);
    return { port, phone, reference };
  }

  @OnEvent(MODEM_STATUS_EVENT)
  async handleModemStatus(payload: ModemStatusPayload): Promise<void> {
    if (!payload.enabled) {
      return;
    }

    await this.prisma.modemState.upsert({
      where: { port: payload.port },
      create: {
        port: payload.port,
        phone: payload.phone,
        status: payload.status,
        signal: payload.signal,
        operator: payload.operator,
        simReady: payload.simReady,
      },
      update: {
        phone: payload.phone,
        status: payload.status,
        signal: payload.signal,
        operator: payload.operator,
        simReady: payload.simReady,
      },
    });
  }

  private buildStateForPort(port: string): ModemRuntimeState {
    const enabled = this.modemConfigService.isPortEnabled(port);
    const phoneOverride = normalizePhone(
      this.modemConfigService.getPhoneOverride(port),
    );

    if (!enabled) {
      return {
        port,
        status: 'disabled',
        signal: null,
        operator: null,
        simReady: false,
        phone: phoneOverride,
        enabled: false,
      };
    }

    const instance = this.instances.get(port);
    if (instance) {
      return { ...instance.getState(), enabled };
    }

    return {
      port,
      status: 'offline',
      signal: null,
      operator: null,
      simReady: false,
      phone: phoneOverride,
      enabled: true,
    };
  }

  private async syncConfiguredPorts(): Promise<void> {
    const config = this.modemConfigService.getConfig();
    const allPorts = this.modemConfigService
      .getEntries()
      .map((entry) => entry.port);
    const activePorts = this.modemConfigService
      .getActiveEntries()
      .map((entry) => entry.port);

    const listedPaths = config.autoDiscover
      ? new Set((await SerialPort.list()).map((item) => item.path))
      : null;

    for (const port of activePorts) {
      const shouldStart =
        !this.instances.has(port) && (!listedPaths || listedPaths.has(port));

      if (shouldStart) {
        await this.startInstance(port);
        await this.sleep(config.connectionStaggerMs);
      }
    }

    for (const [port, instance] of this.instances.entries()) {
      const shouldStop =
        !activePorts.includes(port) || (listedPaths && !listedPaths.has(port));

      if (shouldStop) {
        await instance.stop();
        this.instances.delete(port);
      }
    }

    for (const port of allPorts) {
      if (!this.modemConfigService.isPortEnabled(port)) {
        this.eventEmitter.emit(
          MODEM_STATUS_EVENT,
          this.buildStateForPort(port),
        );
      }
    }
  }

  private startDiscoveryLoop(): void {
    this.discoveryTimer = setInterval(() => {
      void this.syncConfiguredPorts();
    }, this.modemConfigService.getConfig().reconnectIntervalMs);
  }

  private async startInstance(port: string): Promise<void> {
    if (
      this.instances.has(port) ||
      !this.modemConfigService.isPortEnabled(port)
    ) {
      return;
    }

    const instance = new ModemInstance(
      port,
      this.modemConfigService,
      this.atCommandService,
      this.smsParser,
      this.simInboxParser,
      this.eventEmitter,
      new Logger(`Modem:${port}`),
    );

    this.instances.set(port, instance);
    await instance.start();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
