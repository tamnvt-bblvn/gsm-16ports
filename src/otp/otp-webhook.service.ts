import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { OTP_RECEIVED_EVENT } from '../common/events/app.events';
import type { OtpReceivedPayload } from '../common/events/app.events';

@Injectable()
export class OtpWebhookService {
  constructor(
    private readonly appConfig: AppConfigService,
    @InjectPinoLogger(OtpWebhookService.name)
    private readonly logger: PinoLogger,
  ) {}

  @OnEvent(OTP_RECEIVED_EVENT)
  async notify(payload: OtpReceivedPayload): Promise<void> {
    const url = this.appConfig.otpWebhookUrl;
    if (!url) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.appConfig.otpWebhookTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'otp.received',
          port: payload.port,
          phone: payload.phone,
          otp: payload.otp,
          message: payload.message,
          receivedAt: payload.receivedAt.toISOString(),
          smsId: payload.smsId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `otp.webhook_failed status=${response.status} port=${payload.port}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'webhook request failed';
      this.logger.warn(
        `otp.webhook_error reason=${message} port=${payload.port}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
