export type ModemConnectionStatus =
  | 'online'
  | 'offline'
  | 'connecting'
  | 'disabled';

export interface ModemRuntimeState {
  port: string;
  status: ModemConnectionStatus;
  signal: number | null;
  operator: string | null;
  simReady: boolean;
  phone: string | null;
  enabled: boolean;
}
