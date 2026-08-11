import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { ModemConfigService } from '../config/modem-config.service';
import {
  MODEM_STATUS_EVENT,
  SIM_CHANGED_EVENT,
  SIM_ICCID_OBSERVED_EVENT,
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
  private currentIccid: string | null = null;

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
      iccid: null,
      lastError: null,
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
    this.state.status = 'offline';
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

      // Read ICCID on first connect
      await this.readAndTrackIccid();

      await this.refreshMetadata();
      if (this.state.status === 'no_sim') {
        return;
      }
      await this.syncSimInbox();

      this.failureCount = 0;
      this.state.lastError = null;
      this.updateStatus('online');
      this.logger.log(
        `modem.connected port=${this.portName} phone=${this.state.phone ?? 'unknown'} iccid=${this.state.iccid ?? 'unknown'}`,
      );
      this.scheduleHealthCheck();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown connection error';
      this.logThrottledFailure('connection_failed', message);
      this.state.lastError = message;
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
    this.state.iccid = null;
    this.currentIccid = null;
    this.updateStatus('no_sim');
    this.logger.debug(`modem.no_sim port=${this.portName}`);
    await this.closePort(true);
    this.scheduleReconnect(
      this.modemConfigService.getConfig().noSimReconnectIntervalMs,
    );
  }

  private async readIccid(): Promise<string | null> {
    const timeout = this.modemConfigService.getConfig().atCommandTimeoutMs;
    // Try AT+CCID first, then AT+ICCID as fallback
    const commands = ['AT+CCID', 'AT+ICCID'];
    for (const cmd of commands) {
      try {
        const lines = await this.sendCommand(cmd, timeout, true);
        const iccid = this.atCommandService.parseIccid(lines.join('\n'));
        if (iccid) {
          return iccid;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async readAndTrackIccid(): Promise<void> {
    const iccid = await this.readIccid();
    this.currentIccid = iccid;
    this.state.iccid = iccid;

    if (iccid) {
      this.logger.debug(`modem.iccid port=${this.portName} iccid=${iccid}`);
    }
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

    // Network registration check
    try {
      const cregLines = await this.sendCommand(
        'AT+CREG?',
        this.modemConfigService.getConfig().atCommandTimeoutMs,
        true,
      );
      const reg = this.atCommandService.parseRegistration(cregLines.join('\n'));
      if (!reg.registered && this.state.lastError === null) {
        this.state.lastError = 'Mất kết nối mạng, kiểm tra lại sóng';
      } else if (
        reg.registered &&
        this.state.lastError === 'Mất kết nối mạng, kiểm tra lại sóng'
      ) {
        this.state.lastError = null;
      }
    } catch {
      // Ignore if CREG fails
    }

    // SMS Memory check and auto-clear
    try {
      const cpmsLines = await this.sendCommand(
        'AT+CPMS?',
        this.modemConfigService.getConfig().atCommandTimeoutMs,
        true,
      );
      const capacity = this.atCommandService.parseMemoryCapacity(
        cpmsLines.join('\n'),
      );

      if (capacity && capacity.total > 0) {
        const usageRatio = capacity.used / capacity.total;
        if (usageRatio >= 0.9) {
          this.logger.warn(
            `modem.memory_full port=${this.portName} used=${capacity.used} total=${capacity.total} - auto clearing`,
          );
          // Delete all read messages
          await this.sendCommand('AT+CMGD=1,4');
          this.state.lastError = 'Bộ nhớ SMS đầy, đã tự động dọn dẹp tin nhắn';
        }
      }
    } catch {
      // Ignore if CPMS fails
    }

    // Check for SIM change via ICCID
    await this.checkSimChange();

    if (overridePhone) {
      this.state.phone = normalizePhone(overridePhone);
    } else {
      this.state.phone = await this.detectPhoneNumber();
    }

    this.emitStatus();
  }

  /**
   * Detect SIM change by comparing current ICCID with stored value.
   * When SIM changes: clear phone override, re-detect phone, emit event.
   */
  private async checkSimChange(): Promise<void> {
    const newIccid = await this.readIccid();
    const oldIccid = this.currentIccid;

    // If we couldn't read ICCID before and still can't, skip
    if (!oldIccid && !newIccid) {
      return;
    }

    if (newIccid) {
      this.eventEmitter.emit(SIM_ICCID_OBSERVED_EVENT, {
        port: this.portName,
        iccid: newIccid,
        phone: this.state.phone,
      });
    }

    // Same SIM, no change
    if (oldIccid === newIccid) {
      this.state.iccid = newIccid;
      return;
    }

    // SIM changed!
    const oldPhone = this.state.phone;
    this.currentIccid = newIccid;
    this.state.iccid = newIccid;

    this.logger.log(
      `modem.sim_changed port=${this.portName} old_iccid=${oldIccid ?? 'none'} new_iccid=${newIccid ?? 'none'}`,
    );

    // Clear existing phone override since SIM changed
    this.modemConfigService.clearPhoneOverride(this.portName);

    // Try to auto-detect the new phone number
    const newPhone = await this.detectPhoneNumber();
    this.state.phone = newPhone;

    // If detected, save it as the new override
    if (newPhone) {
      this.modemConfigService.updateEntryPhone(this.portName, newPhone);
      this.logger.log(
        `modem.sim_changed_phone_detected port=${this.portName} phone=${newPhone}`,
      );
    } else {
      this.logger.log(
        `modem.sim_changed_phone_unknown port=${this.portName} — user input required`,
      );
    }

    // Emit SIM changed event for dashboard notification
    this.eventEmitter.emit(SIM_CHANGED_EVENT, {
      port: this.portName,
      oldIccid,
      newIccid,
      oldPhone,
      newPhone,
    });

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
              `${this.portName}: ${this.atCommandService.formatFailureMessage(current.lines)}`,
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

  /**
   * Pre-flight check before sending SMS.
   * Validates modem is truly ready to send (not just "online" status).
   */
  private async preFlightSmsCheck(phone: string): Promise<void> {
    if (this.state.status !== 'online') {
      throw new Error(
        `Modem ${this.portName} chưa online (trạng thái: ${this.state.status}), không thể gửi SMS`,
      );
    }

    if (!this.state.simReady) {
      throw new Error(
        `SIM trên ${this.portName} chưa sẵn sàng. Kiểm tra SIM đã cắm đúng.`,
      );
    }

    // Check network registration
    const timeout = this.modemConfigService.getConfig().atCommandTimeoutMs;
    try {
      const cregLines = await this.sendCommand('AT+CREG?', timeout, true);
      const reg = this.atCommandService.parseRegistration(cregLines.join('\n'));
      if (!reg.registered) {
        throw new Error(
          `Modem ${this.portName} chưa đăng ký mạng. Không thể gửi SMS đến ${phone}. Kiểm tra sóng mạng.`,
        );
      }
    } catch (error) {
      // If CREG check itself fails, log but don't block (some modems don't support it)
      if (
        error instanceof Error &&
        error.message.includes('chưa đăng ký mạng')
      ) {
        throw error;
      }
      this.logger.debug(
        `modem.creg_check_failed port=${this.portName} (non-blocking)`,
      );
    }

    // Check signal strength
    if (this.state.signal !== null && this.state.signal < 2) {
      throw new Error(
        `Tín hiệu quá yếu trên ${this.portName} (signal=${this.state.signal}). Di chuyển thiết bị đến nơi có sóng tốt hơn.`,
      );
    }
  }

  async sendSms(phone: string, message: string): Promise<number> {
    // Run pre-flight checks before attempting to send
    await this.preFlightSmsCheck(phone);

    return new Promise<number>((resolve, reject) => {
      this.commandChain = this.commandChain
        .then(async () => {
          if (!this.port?.isOpen) {
            throw new Error(`Cổng ${this.portName} chưa mở`);
          }

          const config = this.modemConfigService.getConfig();
          await this.writeRaw(`AT+CMGS="${phone}"\r`);
          try {
            await this.awaitPromptCharacter(config.atCommandTimeoutMs, phone);
          } catch (error) {
            if (
              error instanceof Error &&
              /CMS ERROR|CME ERROR|: ERROR/i.test(error.message)
            ) {
              throw error;
            }
            throw this.wrapSmsSendError(phone, error);
          }

          const lines = await new Promise<string[]>((cmdResolve, cmdReject) => {
            const timer = setTimeout(() => {
              const captured = this.activeCommand?.lines ?? [];
              this.activeCommand = null;
              cmdReject(
                this.createSmsTimeoutError(
                  phone,
                  captured,
                  config.smsSendTimeoutMs,
                ),
              );
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

          const reference = this.parseSmsReference(lines);
          if (reference < 0) {
            throw new Error(
              `${this.portName} → ${phone}: modem không trả +CMGS (${this.atCommandService.formatFailureMessage(lines)})`,
            );
          }
          return reference;
        })
        .then((reference) => {
          this.state.lastError = null;
          this.logger.log(`sms.sent port=${this.portName} to=${phone}`);
          resolve(reference);
        })
        .catch((error: Error) => {
          this.state.lastError = error.message;
          this.logger.warn(
            `sms.send_failed port=${this.portName} to=${phone} reason=${error.message}`,
          );
          this.emitStatus();
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

  private createSmsTimeoutError(
    phone: string,
    lines: string[],
    timeoutMs: number,
  ): Error {
    if (lines.length) {
      return new Error(
        `Timeout gửi SMS ${this.portName} → ${phone} (${timeoutMs}ms): ${this.atCommandService.formatFailureMessage(lines)}`,
      );
    }
    return new Error(
      `Timeout gửi SMS ${this.portName} → ${phone} (${timeoutMs}ms). Modem không trả +CMGS/OK.`,
    );
  }

  private wrapSmsSendError(phone: string, error: unknown): Error {
    if (error instanceof Error && error.message.includes('Timeout chờ >')) {
      return error;
    }
    return new Error(
      `Không nhận ký tự > sau AT+CMGS (${this.portName} → ${phone}). Modem có thể bận, số sai định dạng, hoặc SIM chưa sẵn sàng gửi SMS.`,
    );
  }

  private awaitPromptCharacter(
    timeoutMs: number,
    phone: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const port = this.port;
      if (!port) {
        reject(new Error(`Cổng ${this.portName} chưa mở`));
        return;
      }

      const captured: string[] = [];
      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) {
            captured.push(trimmed);
          }
        }
        if (text.includes('>')) {
          cleanup();
          resolve();
          return;
        }
        if (/(?:ERROR|\+CMS ERROR|\+CME ERROR)/i.test(text)) {
          cleanup();
          reject(
            new Error(
              `${this.portName} → ${phone}: ${this.atCommandService.formatFailureMessage(captured)}`,
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            captured.length
              ? `Timeout chờ > sau AT+CMGS (${this.portName} → ${phone}): ${this.atCommandService.formatFailureMessage(captured)}`
              : `Timeout chờ > sau AT+CMGS (${this.portName} → ${phone}, ${timeoutMs}ms)`,
          ),
        );
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
    this.state.lastError = reason;
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
      iccid: this.state.iccid,
      lastError: this.state.lastError,
      enabled: this.modemConfigService.isPortEnabled(this.portName),
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
