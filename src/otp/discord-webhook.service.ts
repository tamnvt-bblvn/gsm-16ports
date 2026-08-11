import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { OTP_RECEIVED_EVENT } from '../common/events/app.events';
import type { OtpReceivedPayload } from '../common/events/app.events';

const DISCORD_FIELD_VALUE_MAX = 1024;
const EMBED_COLOR = 0x22d3ee;

@Injectable()
export class DiscordWebhookService {
  constructor(
    private readonly appConfig: AppConfigService,
    @InjectPinoLogger(DiscordWebhookService.name)
    private readonly logger: PinoLogger,
  ) {}

  @OnEvent(OTP_RECEIVED_EVENT)
  async notify(payload: OtpReceivedPayload): Promise<void> {
    const url = this.appConfig.discordWebhookUrl;
    if (!url) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.appConfig.discordWebhookTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.buildPayload(payload)),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `discord.webhook_failed status=${response.status} port=${payload.port}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'webhook request failed';
      this.logger.warn(
        `discord.webhook_error reason=${message} port=${payload.port}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPayload(payload: OtpReceivedPayload) {
    const truncatedMessage =
      payload.message.length > DISCORD_FIELD_VALUE_MAX
        ? `${payload.message.slice(0, DISCORD_FIELD_VALUE_MAX - 1)}…`
        : payload.message;

    return {
      embeds: [
        {
          title: '🔑 OTP mới nhận được',
          color: EMBED_COLOR,
          fields: [
            {
              name: '📱 Số điện thoại',
              value: payload.phone ?? 'Không rõ',
              inline: true,
            },
            { name: '🔌 Cổng', value: payload.port, inline: true },
            { name: '🔢 Mã OTP', value: `\`${payload.otp}\``, inline: true },
            { name: '💬 Nội dung tin nhắn', value: truncatedMessage || '—' },
          ],
          timestamp: payload.receivedAt.toISOString(),
          footer: { text: `SMS ID: ${payload.smsId}` },
        },
      ],
    };
  }
}
