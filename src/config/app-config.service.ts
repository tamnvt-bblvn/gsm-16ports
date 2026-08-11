import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return Number(this.config.get<number>('PORT', 3000));
  }

  get logLevel(): string {
    return this.config.get<string>('LOG_LEVEL', 'info');
  }

  get apiAuthEnabled(): boolean {
    return this.toBoolean(this.config.get('API_AUTH_ENABLED', false));
  }

  get apiKeys(): string[] {
    return this.config
      .get<string>('API_KEYS', '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
  }

  get corsOrigins(): string | string[] {
    const raw = this.config.get<string>('CORS_ORIGINS', '*').trim();
    if (!raw || raw === '*') {
      return '*';
    }
    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get throttleTtlSeconds(): number {
    return Number(this.config.get<number>('THROTTLE_TTL', 60));
  }

  get throttleLimit(): number {
    return Number(this.config.get<number>('THROTTLE_LIMIT', 120));
  }

  get otpWebhookUrl(): string {
    return this.config.get<string>('OTP_WEBHOOK_URL', '').trim();
  }

  get otpWebhookTimeoutMs(): number {
    return Number(this.config.get<number>('OTP_WEBHOOK_TIMEOUT_MS', 5000));
  }

  get discordWebhookUrl(): string {
    return this.config.get<string>('DISCORD_WEBHOOK_URL', '').trim();
  }

  get discordWebhookTimeoutMs(): number {
    return Number(this.config.get<number>('DISCORD_WEBHOOK_TIMEOUT_MS', 5000));
  }

  get swaggerEnabled(): boolean {
    return this.toBoolean(this.config.get('SWAGGER_ENABLED', true));
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  }
}
