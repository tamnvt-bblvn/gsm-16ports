import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { isComPortInRange, normalizeComPort } from '../common/utils/com-port.util';
import {
  ModemConfig,
  ModemEntryConfig,
  ModemsYamlConfig,
} from './modem-config.types';

const DEFAULT_CONFIG: Pick<
  ModemConfig,
  | 'connectionStaggerMs'
  | 'logThrottleMs'
  | 'syncSimInboxOnConnect'
  | 'simSyncTimeoutMs'
  | 'smsSendTimeoutMs'
  | 'noSimReconnectIntervalMs'
> = {
  connectionStaggerMs: 300,
  logThrottleMs: 60_000,
  syncSimInboxOnConnect: true,
  simSyncTimeoutMs: 30_000,
  smsSendTimeoutMs: 15_000,
  noSimReconnectIntervalMs: 60_000,
};

@Injectable()
export class ModemConfigService implements OnModuleInit {
  private readonly logger = new Logger(ModemConfigService.name);
  private config!: ModemConfig;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const configPath = this.resolveConfigPath();
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw) as ModemsYamlConfig;
    this.config = {
      ...DEFAULT_CONFIG,
      ...parsed.modems,
    };
    const active = this.getActiveEntries().length;
    const disabled = this.getEntries().length - active;
    this.logger.log(
      `Loaded modem config from ${configPath} (active=${active}, disabled=${disabled}, autoDiscover=${this.config.autoDiscover})`,
    );
  }

  getConfig(): ModemConfig {
    return this.config;
  }

  getAutoDiscoverEnabled(): boolean {
    return this.config.autoDiscover;
  }

  getEntries(): ModemEntryConfig[] {
    // When autoDiscover is true, only return explicit entries
    // (ports are discovered dynamically via SerialPort.list())
    if (this.config.autoDiscover) {
      return this.config.entries ?? [];
    }

    if (this.config.entries?.length) {
      return this.config.entries;
    }
    return this.expandPortRange(
      this.config.portRange.from,
      this.config.portRange.to,
    );
  }

  getActiveEntries(): ModemEntryConfig[] {
    return this.getEntries().filter((entry) => this.isPortEnabled(entry.port));
  }

  getEntry(port: string): ModemEntryConfig | undefined {
    const normalizedPort = normalizeComPort(port);
    return this.getEntries().find((entry) => entry.port === normalizedPort);
  }

  isPortEnabled(port: string): boolean {
    const entry = this.getEntry(port);
    // When autoDiscover is on and no entry exists, port is enabled by default
    if (!entry && this.config.autoDiscover) {
      return true;
    }
    return entry?.enabled !== false;
  }

  /** True when port is inside configured portRange (inclusive). */
  isWithinPortRange(port: string): boolean {
    return isComPortInRange(
      port,
      this.config.portRange.from,
      this.config.portRange.to,
    );
  }

  getPhoneOverride(port: string): string | undefined {
    const phone = this.getEntry(port)?.phone?.trim();
    return phone || undefined;
  }

  /**
   * Ensure an entry exists for the given port. Creates one if missing.
   * Used by auto-discover to persist newly found ports.
   */
  ensureEntry(port: string): ModemEntryConfig {
    const normalizedPort = port.trim().toUpperCase();
    const entries = this.config.entries ?? [];
    let entry = entries.find((item) => item.port === normalizedPort);

    if (!entry) {
      entry = { port: normalizedPort, enabled: true, phone: '' };
      entries.push(entry);
      this.config.entries = entries;
      this.persistConfig();
      this.logger.log(`Auto-discovered new port: ${normalizedPort}`);
    }

    return entry;
  }

  updateEntryEnabled(port: string, enabled: boolean): void {
    const normalizedPort = port.trim().toUpperCase();
    const entries = this.config.entries ?? [];
    let entry = entries.find((item) => item.port === normalizedPort);

    if (!entry) {
      entry = { port: normalizedPort, enabled, phone: '' };
      entries.push(entry);
      this.config.entries = entries;
    } else {
      entry.enabled = enabled;
    }

    this.persistConfig();
    this.logger.log(
      `Updated enabled=${enabled} for ${normalizedPort}`,
    );
  }

  updateEntryPhone(port: string, phone: string): void {
    const normalizedPort = port.trim().toUpperCase();
    const entries = this.config.entries ?? [];
    let entry = entries.find((item) => item.port === normalizedPort);

    if (!entry) {
      entry = { port: normalizedPort, enabled: true, phone };
      entries.push(entry);
      this.config.entries = entries;
    } else {
      entry.phone = phone;
    }

    this.persistConfig();
    this.logger.log(`Updated phone override for ${normalizedPort}`);
  }

  /**
   * Clear phone override for a port (used when SIM changes).
   * Only clears the phone field, keeps enabled state.
   */
  clearPhoneOverride(port: string): void {
    const normalizedPort = port.trim().toUpperCase();
    const entry = this.getEntry(normalizedPort);
    if (entry && entry.phone) {
      entry.phone = '';
      this.persistConfig();
      this.logger.log(`Cleared phone override for ${normalizedPort} (SIM changed)`);
    }
  }

  getConfigFilePath(): string {
    return this.resolveConfigPath();
  }

  private persistConfig(): void {
    const configPath = this.resolveConfigPath();
    const payload: ModemsYamlConfig = { modems: this.config };
    const body = yaml.dump(payload, {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
    });
    fs.writeFileSync(configPath, body, 'utf8');
  }

  private resolveConfigPath(): string {
    const configured = this.configService.get<string>(
      'MODEMS_CONFIG',
      './config/modems.yaml',
    );
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  private expandPortRange(from: string, to: string): ModemEntryConfig[] {
    const fromNum = this.parseComNumber(from);
    const toNum = this.parseComNumber(to);
    const start = Math.min(fromNum, toNum);
    const end = Math.max(fromNum, toNum);
    const entries: ModemEntryConfig[] = [];

    for (let i = start; i <= end; i += 1) {
      entries.push({ port: `COM${i}`, phone: '', enabled: true });
    }

    return entries;
  }

  private parseComNumber(port: string): number {
    const match = /^COM(\d+)$/i.exec(port.trim());
    if (!match) {
      throw new Error(`Invalid COM port format: ${port}`);
    }
    return Number.parseInt(match[1], 10);
  }
}

