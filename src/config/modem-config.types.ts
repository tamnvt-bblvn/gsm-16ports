export interface ModemEntryConfig {
  port: string;
  phone?: string;
  enabled?: boolean;
  note?: string;
  /**
   * Operator-assigned physical slot label (e.g. "Khe 01"), since the OS
   * assigns COM numbers by USB enumeration history — not by physical
   * position on the hub — so the dashboard can't infer slot order on
   * its own. Once set, used to sort/display instead of the raw COM name.
   */
  label?: string;
}

export interface ModemConfig {
  autoDiscover: boolean;
  portRange: {
    from: string;
    to: string;
  };
  baudRate: number;
  reconnectIntervalMs: number;
  noSimReconnectIntervalMs: number;
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
