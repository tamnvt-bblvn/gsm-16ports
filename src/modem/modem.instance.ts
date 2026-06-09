import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { ModemConfigService } from '../config/modem-config.service';
import {
  MODEM_STATUS_EVENT,
  SMS_RECEIVED_EVENT,
} from '../common/events/app.events';
import { normalizePhone } from '../common/utils/phone.util';
import { AtCommandService, type SimState } from './at-command.service';
import { ModemConnectionStatus, ModemRuntimeState } from './modem.types';
import { SimInboxParser } from './sim-inbox.parser';
import { SmsParser } from './sms.parser';

const QUIET_ERRORS = new Set(['Port closed', 'Port closed during reconnect']);

export class ModemInstance {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private state: ModemRuntimeState;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private commandChain: Promise<void> = Promise.resolve();
  private activeCommand: {
    lines: string[];
    resolve: (lines: string[]) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private destroyed = false;
  private failureCount = 0;
  private lastFailureLogAt = 0;
  private closingIntentionally = false;
  private connectingInProgress = false;

  constructor(
    private readonly portName: string,
    private readonly modemConfigService: ModemConfigService,
    private readonly atCommandService: AtCommandService,
    private readonly smsParser: SmsParser,
    private readonly simInboxParser: SimInboxParser,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: Logger,
  ) {
    this.state = {
      port: portName,
      status: 'offline',
      signal: null,
      operator: null,
      simReady: false,
      phone: normalizePhone(modemConfigService.getPhoneOverride(portName)),
      enabled: true,
    };
  }

  getState(): ModemRuntimeState {
    return { ...this.state };
  }

  applyPhoneOverride(phone: string | null): void {
    this.state.phone = phone ? normalizePhone(phone) : null;
    this.emitStatus();
  }

  async start(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.destroyed = true;
    this.clearTimers();
    await this.closePort(true);
    this.updateStatus('offline');
  }

  private async connect(): Promise<void> {
    if (this.destroyed || this.connectingInProgress) {
      return;
    }

    this.connectingInProgress = true;
    this.updateStatus('connecting');
    await this.closePort(true);

    const config = this.modemConfigService.getConfig();
    try {
      this.port = new SerialPort({
        path: this.portName,
        baudRate: config.baudRate,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        this.port!.open((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      this.parser.on('data', (line: string) => this.handleLine(line));
      this.port.on('close', () => {
        if (!this.closingIntentionally) {
          void this.handleDisconnect('port closed');
        }
      });
      this.port.on('error', (error) => {
        if (!this.closingIntentionally) {
          void this.handleDisconnect(error.message);
        }
      });

      const timeout = config.atCommandTimeoutMs;
      await this.sendCommand('AT', timeout, true);

      const simState = await this.probeSimPresence();
      if (simState === 'absent') {
        await this.handleNoSim();
        return;
      }

      await this.sendCommand('AT+CMGF=1', timeout, true);
      await this.sendCommand('AT+CNMI=2,2,0,0,0', timeout, true);
      await this.refreshMetadata();
      if (this.state.status === 'no_sim') {
        return;
      }
      await this.syncSimInbox();

      this.failureCount = 0;
      this.updateStatus('online');
      this.logger.log(
        `modem.connected port=${this.portName} phone=${this.state.phone ?? 'unknown'}`,
      );
      this.scheduleHealthCheck();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown connection error';
      this.logThrottledFailure('connection_failed', message);
      this.updateStatus('offline');
      this.scheduleReconnect();
    } finally {
      this.connectingInProgress = false;
    }
  }

  private async probeSimPresence(): Promise<SimState> {
    const timeout = this.modemConfigService.getConfig().atCommandTimeoutMs;
    try {
      const lines = await this.sendCommand('AT+CPIN?', timeout, true);
      return this.atCommandService.parseSimState(lines.join('\n'));
    } catch {
      return 'other';
    }
  }

  private async handleNoSim(): Promise<void> {
    this.clearHealthTimer();
    this.state.simReady = false;
    this.state.signal = null;
    this.state.operator = null;
    this.updateStatus('no_sim');
    this.logger.debug(`modem.no_sim port=${this.portName}`);
    await this.closePort(true);
    this.scheduleReconnect(
      this.modemConfigService.getConfig().noSimReconnectIntervalMs,
    );
  }

  private async detectPhoneNumber(): Promise<string | null> {
    const timeout = this.modemConfigService.getConfig().atCommandTimeoutMs;
    const lookups = [
      async () => this.sendCommand('AT+CNUM', timeout, true),
      async () => this.sendCommand('AT+CPBR=1,1', timeout, true),
    ];

    for (const lookup of lookups) {
      try {
        const lines = await lookup();
        const detectedPhone = this.atCommandService.parsePhoneNumber(
          lines.join('\n'),
        );
        if (detectedPhone) {
          return normalizePhone(detectedPhone);
        }
      } catch {
        continue;
      }
    }

    this.logger.debug(`modem.phone_not_found port=${this.portName}`);
    return null;
  }

  private async syncSimInbox(): Promise<void> {
    const config = this.modemConfigService.getConfig();
    if (!config.syncSimInboxOnConnect || !this.state.simReady) {
      return;
    }

    try {
      const lines = await this.sendCommand(
        'AT+CMGL="ALL"',
        config.simSyncTimeoutMs,
      );
      const storedMessages = this.simInboxParser.parseCmglResponse(lines);
      if (!storedMessages.length) {
        return;
      }

      this.logger.log(
        `modem.sim_inbox_synced port=${this.portName} count=${storedMessages.length}`,
      );

      for (const sms of storedMessages) {
        this.eventEmitter.emit(SMS_RECEIVED_EVENT, {
          port: this.portName,
          sender: sms.sender,
          message: sms.message,
          receivedAt: sms.receivedAt,
          source: 'sim-inbox',
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'sim inbox sync failed';
      this.logger.warn(
        `modem.sim_inbox_sync_failed port=${this.portName} reason=${message}`,
      );
    }
  }

  private async refreshMetadata(): Promise<void> {
    const overridePhone = this.modemConfigService.getPhoneOverride(
      this.portName,
    );

    const csqLines = await this.sendCommand('AT+CSQ');
    const copsLines = await this.sendCommand('AT+COPS?');
    const cpinLines = await this.sendCommand('AT+CPIN?');

    this.state.signal = this.atCommandService.parseSignal(csqLines.join('\n'));
    this.state.operator = this.atCommandService.parseOperator(
      copsLines.join('\n'),
    );
    const simState = this.atCommandService.parseSimState(cpinLines.join('\n'));
    this.state.simReady = simState === 'ready';

    if (simState === 'absent') {
      await this.handleNoSim();
      return;
    }

    if (overridePhone) {
      this.state.phone = normalizePhone(overridePhone);
    } else {
      this.state.phone = await this.detectPhoneNumber();
    }

    this.emitStatus();
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (this.atCommandService.isUnsolicited(trimmed)) {
      const sms = this.smsParser.parseLine(this.portName, trimmed);
      if (sms) {
        this.logger.log(`sms.received port=${sms.port} sender=${sms.sender}`);
        this.eventEmitter.emit(SMS_RECEIVED_EVENT, sms);
      }
      return;
    }

    if (this.activeCommand) {
      this.activeCommand.lines.push(trimmed);
      if (this.atCommandService.isFinalResponse(trimmed)) {
        const current = this.activeCommand;
        this.activeCommand = null;
        clearTimeout(current.timer);
        if (trimmed === 'OK') {
          current.resolve(current.lines);
        } else {
          current.reject(
            new Error(
              `AT command failed on ${this.portName}: ${current.lines.join(' | ')}`,
            ),
          );
        }
      }
      return;
    }

    const sms = this.smsParser.parseLine(this.portName, trimmed);
    if (sms) {
      this.logger.log(`sms.received port=${sms.port} sender=${sms.sender}`);
      this.eventEmitter.emit(SMS_RECEIVED_EVENT, sms);
    }
  }

  private sendCommand(
    command: string,
    timeoutMs = this.modemConfigService.getConfig().atCommandTimeoutMs,
    quiet = false,
  ): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      this.commandChain = this.commandChain
        .then(async () => {
          if (!this.port?.isOpen) {
            throw new Error(`Port ${this.portName} is not open`);
          }

          await new Promise<void>((writeResolve, writeReject) => {
            this.port!.write(`${command}\r`, (error) => {
              if (error) {
                writeReject(error);
                return;
              }
              writeResolve();
            });
          });

          const lines = await new Promise<string[]>((cmdResolve, cmdReject) => {
            const timer = setTimeout(() => {
              if (this.activeCommand) {
                this.activeCommand = null;
              }
              cmdReject(
                new Error(`AT command timeout on ${this.portName}: ${command}`),
              );
            }, timeoutMs);

            this.activeCommand = {
              lines: [],
              resolve: cmdResolve,
              reject: cmdReject,
              timer,
            };
          });

          return lines;
        })
        .then(resolve)
        .catch((error: Error) => {
          if (!quiet && !this.shouldSuppressCommandError(error.message)) {
            this.logger.warn(
              `at.command_failed port=${this.portName} command=${command} reason=${error.message}`,
            );
          }
          reject(error);
        });
    });
  }

  async sendSms(phone: string, message: string): Promise<number> {
    if (this.state.status !== 'online') {
      throw new Error(`Modem ${this.portName} is not online`);
    }

    return new Promise<number>((resolve, reject) => {
      this.commandChain = this.commandChain
        .then(async () => {
          if (!this.port?.isOpen) {
            throw new Error(`Port ${this.portName} is not open`);
          }

          const config = this.modemConfigService.getConfig();
          await this.writeRaw(`AT+CMGS="${phone}"\r`);
          await this.awaitPromptCharacter(config.atCommandTimeoutMs);

          const lines = await new Promise<string[]>((cmdResolve, cmdReject) => {
            const timer = setTimeout(() => {
              this.activeCommand = null;
              cmdReject(new Error(`SMS send timeout on ${this.portName}`));
            }, config.smsSendTimeoutMs);

            this.activeCommand = {
              lines: [],
              resolve: cmdResolve,
              reject: cmdReject,
              timer,
            };

            this.writeRaw(`${message}\u001a`).catch((error: Error) => {
              clearTimeout(timer);
              this.activeCommand = null;
              cmdReject(error);
            });
          });

          return this.parseSmsReference(lines);
        })
        .then((reference) => {
          this.logger.log(`sms.sent port=${this.portName} to=${phone}`);
          resolve(reference);
        })
        .catch((error: Error) => {
          this.logger.warn(
            `sms.send_failed port=${this.portName} to=${phone} reason=${error.message}`,
          );
          reject(error);
        });
    });
  }

  private writeRaw(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.port?.isOpen) {
        reject(new Error(`Port ${this.portName} is not open`));
        return;
      }
      this.port.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  private awaitPromptCharacter(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const port = this.port;
      if (!port) {
        reject(new Error(`Port ${this.portName} is not open`));
        return;
      }

      const onData = (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('>')) {
          cleanup();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SMS prompt timeout on ${this.portName}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        port.off('data', onData);
      };

      port.on('data', onData);
    });
  }

  private parseSmsReference(lines: string[]): number {
    for (const line of lines) {
      const match = /\+CMGS:\s*(\d+)/.exec(line);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
    return -1;
  }

  private async handleDisconnect(reason: string): Promise<void> {
    if (this.destroyed || this.state.status === 'offline') {
      return;
    }

    this.logThrottledFailure('disconnected', reason);
    this.updateStatus('offline');
    await this.closePort(true);
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.destroyed || this.reconnectTimer) {
      return;
    }

    const config = this.modemConfigService.getConfig();
    const delay =
      delayMs ??
      (this.state.status === 'no_sim'
        ? config.noSimReconnectIntervalMs
        : config.reconnectIntervalMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private scheduleHealthCheck(): void {
    this.clearHealthTimer();
    const interval = this.modemConfigService.getConfig().healthCheckIntervalMs;
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, interval);
  }

  private async runHealthCheck(): Promise<void> {
    if (this.destroyed || this.state.status !== 'online') {
      return;
    }

    try {
      await this.sendCommand('AT');
      await this.refreshMetadata();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'health check failed';
      await this.handleDisconnect(message);
    }
  }

  private logThrottledFailure(event: string, reason: string): void {
    this.failureCount += 1;
    const now = Date.now();
    const throttleMs = this.modemConfigService.getConfig().logThrottleMs;
    const shouldLog =
      this.failureCount === 1 || now - this.lastFailureLogAt >= throttleMs;

    if (shouldLog) {
      this.logger.warn(
        `modem.${event} port=${this.portName} reason=${reason} attempts=${this.failureCount}`,
      );
      this.lastFailureLogAt = now;
      return;
    }

    this.logger.debug(
      `modem.${event}_retry port=${this.portName} attempts=${this.failureCount}`,
    );
  }

  private shouldSuppressCommandError(message: string): boolean {
    return (
      this.closingIntentionally ||
      QUIET_ERRORS.has(message) ||
      message.startsWith('Port closed')
    );
  }

  private updateStatus(status: ModemConnectionStatus): void {
    this.state.status = status;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.eventEmitter.emit(MODEM_STATUS_EVENT, {
      port: this.state.port,
      status: this.state.status,
      signal: this.state.signal,
      operator: this.state.operator,
      simReady: this.state.simReady,
      phone: this.state.phone,
      enabled: this.state.enabled,
    });
  }

  private async closePort(intentional = false): Promise<void> {
    this.closingIntentionally = intentional;
    this.clearHealthTimer();

    if (this.activeCommand) {
      clearTimeout(this.activeCommand.timer);
      this.activeCommand.reject(
        new Error(intentional ? 'Port closed during reconnect' : 'Port closed'),
      );
      this.activeCommand = null;
    }

    if (!this.port) {
      this.closingIntentionally = false;
      return;
    }

    const currentPort = this.port;
    this.port = null;
    this.parser = null;

    if (currentPort.isOpen) {
      await new Promise<void>((resolve) => {
        currentPort.close(() => resolve());
      });
    }

    this.closingIntentionally = false;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHealthTimer();
  }

  private clearHealthTimer(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
