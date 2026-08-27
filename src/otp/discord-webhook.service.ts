import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { OTP_RECEIVED_EVENT } from '../common/events/app.events';
import type { OtpReceivedPayload } from '../common/events/app.events';
import { postWebhookWithRetry } from '../common/utils/webhook-post.util';

const DISCORD_FIELD_VALUE_MAX = 1024;
const EMBED_COLOR = 0x22d3ee;

export interface DiscordWebhookStatus {
  configured: boolean;
  lastResult: 'ok' | 'error' | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

@Injectable()
export class DiscordWebhookService {
  private lastResult: 'ok' | 'error' | null = null;
  private lastAttemptAt: Date | null = null;
  private lastError: string | null = null;

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

    // Retries so a Discord rate-limit (5 req/2s per webhook) or a transient
    // network blip doesn't silently drop a time-sensitive OTP — this is the
    // channel operators actually watch, so best-effort single-shot isn't
    // good enough here.
    const result = await postWebhookWithRetry({
      url,
      body: this.buildPayload(payload),
      timeoutMs: this.appConfig.discordWebhookTimeoutMs,
      onAttemptFailed: (reason, attempt, maxAttempts) => {
        this.logger.warn(
          `discord.webhook_attempt_failed reason=${reason} port=${payload.port} attempt=${attempt}/${maxAttempts}`,
        );
      },
    });

    this.recordResult(result);
  }

  /** Sends a sample embed so an admin can verify the webhook from the dashboard. */
  async sendTest(): Promise<{ ok: boolean; reason?: string }> {
    const url = this.appConfig.discordWebhookUrl;
    if (!url) {
      return { ok: false, reason: 'DISCORD_WEBHOOK_URL chưa được cấu hình' };
    }

    const result = await postWebhookWithRetry({
      url,
      body: this.buildTestPayload(),
      timeoutMs: this.appConfig.discordWebhookTimeoutMs,
      onAttemptFailed: (reason, attempt, maxAttempts) => {
        this.logger.warn(
          `discord.webhook_test_attempt_failed reason=${reason} attempt=${attempt}/${maxAttempts}`,
        );
      },
    });

    this.recordResult(result);
    return result;
  }

  getStatus(): DiscordWebhookStatus {
    return {
      configured: Boolean(this.appConfig.discordWebhookUrl),
      lastResult: this.lastResult,
      lastAttemptAt: this.lastAttemptAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  private recordResult(result: { ok: boolean; reason?: string }): void {
    this.lastAttemptAt = new Date();
    this.lastResult = result.ok ? 'ok' : 'error';
    this.lastError = result.ok ? null : (result.reason ?? 'unknown error');
  }

  private buildTestPayload() {
    return {
      embeds: [
        {
          title: '✅ Kiểm tra kết nối Discord webhook',
          description:
            'Nếu bạn thấy tin nhắn này, webhook đã được cấu hình đúng và sẵn sàng nhận OTP.',
          color: EMBED_COLOR,
          timestamp: new Date().toISOString(),
        },
      ],
    };
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
          // Big markdown heading so the code is the visual focal point,
          // instead of being squeezed into a small field next to phone/port.
          description: `# \`${payload.otp}\``,
          color: EMBED_COLOR,
          fields: [
            {
              name: '📱 Số điện thoại',
              value: payload.phone ?? 'Không rõ',
              inline: true,
            },
            { name: '🔌 Cổng', value: payload.port, inline: true },
            { name: '💬 Nội dung tin nhắn', value: truncatedMessage || '—' },
          ],
          timestamp: payload.receivedAt.toISOString(),
          footer: { text: `SMS ID: ${payload.smsId}` },
        },
      ],
    };
  }
}
