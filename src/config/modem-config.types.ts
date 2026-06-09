export interface ModemEntryConfig {
  port: string;
  phone?: string;
  enabled?: boolean;
  note?: string;
}

export interface ModemConfig {
  autoDiscover: boolean;
  portRange: {
    from: string;
    to: string;
  };
  baudRate: number;
  reconnectIntervalMs: number;
  healthCheckIntervalMs: number;
  atCommandTimeoutMs: number;
  connectionStaggerMs: number;
  logThrottleMs: number;
  syncSimInboxOnConnect: boolean;
  simSyncTimeoutMs: number;
  smsSendTimeoutMs: number;
  entries: ModemEntryConfig[];
}

export interface ModemsYamlConfig {
  modems: ModemConfig;
}
