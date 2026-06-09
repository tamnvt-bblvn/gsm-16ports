export const SMS_RECEIVED_EVENT = 'sms.received';
export const OTP_RECEIVED_EVENT = 'otp.received';
export const MODEM_STATUS_EVENT = 'modem.status';

export interface SmsReceivedPayload {
  port: string;
  sender: string;
  message: string;
  receivedAt: Date;
  source?: 'realtime' | 'sim-inbox';
}

export interface OtpReceivedPayload {
  port: string;
  phone: string | null;
  otp: string;
  message: string;
  receivedAt: Date;
  smsId: string;
}

export interface ModemStatusPayload {
  port: string;
  status: 'online' | 'offline' | 'connecting' | 'no_sim' | 'disabled';
  signal: number | null;
  operator: string | null;
  simReady: boolean;
  phone: string | null;
  enabled: boolean;
}
