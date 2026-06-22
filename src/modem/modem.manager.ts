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
  private knownSystemPorts = new Set<string>();

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
    await this.discoverAndSync();
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
    // Combine configured entries + any discovered ports with running instances
    const portSet = new Set<string>();

    // Add all configured entries
    for (const entry of this.modemConfigService.getEntries()) {
      portSet.add(entry.port);
    }

    // Add all currently running instances (auto-discovered)
    for (const port of this.instances.keys()) {
      portSet.add(port);
    }

    return [...portSet]
      .map((port) => this.buildStateForPort(port))
      .sort((a, b) =>
        a.port.localeCompare(b.port, undefined, { numeric: true }),
      );
  }

  getState(port: string): ModemRuntimeState | null {
    const hasEntry = !!this.modemConfigService.getEntry(port);
    const hasInstance = this.instances.has(port);

    if (!hasEntry && !hasInstance) {
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

    // Ensure entry exists (auto-discover may not have created one yet)
    this.modemConfigService.ensureEntry(normalizedPort);
    this.modemConfigService.updateEntryEnabled(normalizedPort, enabled);

    const instance = this.instances.get(normalizedPort);
    if (!enabled) {
      if (instance) {
        await instance.stop();
        this.instances.delete(normalizedPort);
      }
    } else {
      if (!this.instances.has(normalizedPort)) {
        // Check if port exists on system
        const systemPorts = new Set(
          (await SerialPort.list()).map((item) => item.path),
        );
        if (systemPorts.has(normalizedPort)) {
          await this.startInstance(normalizedPort);
        }
      }
    }

    const state = this.buildStateForPort(normalizedPort);
    this.eventEmitter.emit(MODEM_STATUS_EVENT, state);
    return state;
  }

  updatePortPhone(port: string, phone: string): ModemRuntimeState {
    const normalizedPort = port.trim().toUpperCase();

    // Ensure entry exists
    this.modemConfigService.ensureEntry(normalizedPort);

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
    const instance = this.instances.get(port);
    if (!instance) {
      throw new Error(`Modem ${port} chưa kết nối`);
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
        iccid: payload.iccid,
      },
      update: {
        phone: payload.phone,
        status: payload.status,
        signal: payload.signal,
        operator: payload.operator,
        simReady: payload.simReady,
        iccid: payload.iccid,
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
        iccid: null,
        lastError: null,
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
      iccid: null,
      lastError: null,
      enabled: true,
    };
  }

  /**
   * Discover all COM ports on the system and sync with running instances.
   * When autoDiscover is enabled, scans ALL system COM ports.
   * New ports → auto-create config entry + start instance.
   * Removed ports → stop instance.
   */
  private async discoverAndSync(): Promise<void> {
    const config = this.modemConfigService.getConfig();

    if (config.autoDiscover) {
      await this.autoDiscoverPorts(config);
    } else {
      await this.syncConfiguredPorts(config);
    }
  }

  /**
   * Auto-discover mode: scan ALL system COM ports.
   */
  private async autoDiscoverPorts(
    config: ReturnType<ModemConfigService['getConfig']>,
  ): Promise<void> {
    const systemPorts = (await SerialPort.list()).map((item) => item.path);
    const systemPortSet = new Set(systemPorts);
    const previousPorts = new Set(this.knownSystemPorts);
    this.knownSystemPorts = systemPortSet;

    // Detect newly appeared ports
    for (const port of systemPorts) {
      if (!this.instances.has(port)) {
        if (this.modemConfigService.isPortEnabled(port)) {
          // Ensure entry exists in config (persists phone override etc.)
          this.modemConfigService.ensureEntry(port);

          if (!previousPorts.size || !previousPorts.has(port)) {
            this.logger.info(`modem.auto_discovered port=${port}`);
          }

          await this.startInstance(port);
          await this.sleep(config.connectionStaggerMs);
        }
      }
    }

    // Stop instances for ports that disappeared from system
    for (const [port, instance] of this.instances.entries()) {
      if (!systemPortSet.has(port)) {
        this.logger.info(`modem.port_removed port=${port}`);
        await instance.stop();
        this.instances.delete(port);
        this.eventEmitter.emit(
          MODEM_STATUS_EVENT,
          this.buildStateForPort(port),
        );
      }
    }
  }

  /**
   * Manual mode: sync using configured entries.
   */
  private async syncConfiguredPorts(
    config: ReturnType<ModemConfigService['getConfig']>,
  ): Promise<void> {
    const allPorts = this.modemConfigService
      .getEntries()
      .map((entry) => entry.port);
    const activePorts = this.modemConfigService
      .getActiveEntries()
      .map((entry) => entry.port);

    for (const port of activePorts) {
      if (!this.instances.has(port)) {
        await this.startInstance(port);
        await this.sleep(config.connectionStaggerMs);
      }
    }

    for (const [port, instance] of this.instances.entries()) {
      if (!activePorts.includes(port)) {
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
      void this.discoverAndSync();
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

