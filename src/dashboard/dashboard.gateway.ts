import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server } from 'socket.io';
import {
  MODEM_REMOVED_EVENT,
  MODEM_STATUS_EVENT,
  OTP_RECEIVED_EVENT,
  SIM_CHANGED_EVENT,
  SIM_PORT_CHANGED_EVENT,
  SMS_RECEIVED_EVENT,
} from '../common/events/app.events';
import { decodeSmsBody } from '../common/utils/sms-body.util';
import type {
  ModemRemovedPayload,
  ModemStatusPayload,
  OtpReceivedPayload,
  SimChangedPayload,
  SimPortChangedPayload,
  SmsReceivedPayload,
} from '../common/events/app.events';
import { OtpExtractor } from '../otp/otp.extractor';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class DashboardGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly otpExtractor: OtpExtractor) {}

  @OnEvent(MODEM_STATUS_EVENT)
  handleModemStatus(payload: ModemStatusPayload): void {
    this.server?.emit('modem.status', payload);
  }

  @OnEvent(MODEM_REMOVED_EVENT)
  handleModemRemoved(payload: ModemRemovedPayload): void {
    this.server?.emit('modem.removed', payload);
  }

  @OnEvent(SMS_RECEIVED_EVENT)
  handleSmsReceived(payload: SmsReceivedPayload): void {
    const message = decodeSmsBody(payload.message);
    const otpCode = this.otpExtractor.extract(message);
    this.server?.emit('sms.received', {
      ...payload,
      message,
      otpCode,
      receivedAt: payload.receivedAt.toISOString(),
    });
  }

  @OnEvent(OTP_RECEIVED_EVENT)
  handleOtpReceived(payload: OtpReceivedPayload): void {
    this.server?.emit('otp.received', {
      ...payload,
      receivedAt: payload.receivedAt.toISOString(),
    });
  }

  @OnEvent(SIM_CHANGED_EVENT)
  handleSimChanged(payload: SimChangedPayload): void {
    this.server?.emit('sim.changed', payload);
  }

  @OnEvent(SIM_PORT_CHANGED_EVENT)
  handleSimPortChanged(payload: SimPortChangedPayload): void {
    this.server?.emit('sim.port_changed', {
      ...payload,
      previousSeenAt: payload.previousSeenAt.toISOString(),
      detectedAt: payload.detectedAt.toISOString(),
    });
  }
}
