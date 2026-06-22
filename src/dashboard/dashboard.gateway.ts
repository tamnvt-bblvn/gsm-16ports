import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server } from 'socket.io';
import {
  MODEM_STATUS_EVENT,
  OTP_RECEIVED_EVENT,
  SIM_CHANGED_EVENT,
  SMS_RECEIVED_EVENT,
} from '../common/events/app.events';
import { decodeSmsBody } from '../common/utils/sms-body.util';
import type {
  ModemStatusPayload,
  OtpReceivedPayload,
  SimChangedPayload,
  SmsReceivedPayload,
} from '../common/events/app.events';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class DashboardGateway {
  @WebSocketServer()
  server!: Server;

  @OnEvent(MODEM_STATUS_EVENT)
  handleModemStatus(payload: ModemStatusPayload): void {
    this.server?.emit('modem.status', payload);
  }

  @OnEvent(SMS_RECEIVED_EVENT)
  handleSmsReceived(payload: SmsReceivedPayload): void {
    this.server?.emit('sms.received', {
      ...payload,
      message: decodeSmsBody(payload.message),
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
}

