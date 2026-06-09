import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OTP_RECEIVED_EVENT } from '../common/events/app.events';
import type { OtpReceivedPayload } from '../common/events/app.events';
import { phonesMatch } from '../common/utils/phone.util';

interface WaitRequest {
  port?: string;
  phone?: string;
  resolve: (value: OtpWaitResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface OtpWaitResult {
  port?: string;
  phone?: string | null;
  otp: string;
  receivedAt: string;
  message: string;
}

@Injectable()
export class WaitOtpService {
  private waiters: WaitRequest[] = [];

  waitForOtp(options: {
    port?: string;
    phone?: string;
    timeout: number;
  }): Promise<OtpWaitResult> {
    if (!options.port && !options.phone) {
      return Promise.reject(new Error('Either port or phone must be provided'));
    }

    return new Promise<OtpWaitResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(new Error('OTP wait timeout'));
      }, options.timeout * 1000);

      const waiter: WaitRequest = {
        port: options.port,
        phone: options.phone,
        resolve,
        reject,
        timer,
      };

      this.waiters.push(waiter);
    });
  }

  @OnEvent(OTP_RECEIVED_EVENT)
  handleOtpReceived(payload: OtpReceivedPayload): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.port && waiter.port !== payload.port) {
        continue;
      }

      if (waiter.phone && !phonesMatch(waiter.phone, payload.phone)) {
        continue;
      }

      this.removeWaiter(waiter);
      waiter.resolve({
        port: payload.port,
        phone: payload.phone,
        otp: payload.otp,
        receivedAt: payload.receivedAt.toISOString(),
        message: payload.message,
      });
    }
  }

  private removeWaiter(waiter: WaitRequest): void {
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter((item) => item !== waiter);
  }
}
