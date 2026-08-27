export type ModemConnectionStatus =
  | 'online'
  | 'offline'
  | 'connecting'
  | 'no_sim'
  | 'disabled';

export interface ModemRuntimeState {
  port: string;
  status: ModemConnectionStatus;
  signal: number | null;
  operator: string | null;
  simReady: boolean;
  phone: string | null;
  iccid: string | null;
  lastError: string | null;
  enabled: boolean;
  /** Operator-assigned physical slot label; null when never set. */
  label: string | null;
}
