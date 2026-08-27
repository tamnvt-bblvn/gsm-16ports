import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { OTP_RECEIVED_EVENT } from '../common/events/app.events';
import type { OtpReceivedPayload } from '../common/events/app.events';
import { postWebhookWithRetry } from '../common/utils/webhook-post.util';

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

    await postWebhookWithRetry({
      url,
      body: {
        event: 'otp.received',
        port: payload.port,
        phone: payload.phone,
        otp: payload.otp,
        message: payload.message,
        receivedAt: payload.receivedAt.toISOString(),
        smsId: payload.smsId,
      },
      timeoutMs: this.appConfig.otpWebhookTimeoutMs,
      onAttemptFailed: (reason, attempt, maxAttempts) => {
        this.logger.warn(
          `otp.webhook_attempt_failed reason=${reason} port=${payload.port} attempt=${attempt}/${maxAttempts}`,
        );
      },
    });
  }
}
