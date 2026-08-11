import { DiscordWebhookService } from './discord-webhook.service';
import type { OtpReceivedPayload } from '../common/events/app.events';

interface DiscordEmbedField {
  name: string;
  value: string;
}

interface DiscordEmbedBody {
  embeds: Array<{ description: string; fields: DiscordEmbedField[] }>;
}

type FetchMock = jest.Mock<
  Promise<{ ok: boolean; status: number }>,
  [string, { method: string; body: string }]
>;

function makeService(discordWebhookUrl: string) {
  const appConfig = {
    discordWebhookUrl,
    discordWebhookTimeoutMs: 5000,
  } as never;
  const logger = { warn: jest.fn() } as never;
  return new DiscordWebhookService(appConfig, logger);
}

function makePayload(
  overrides: Partial<OtpReceivedPayload> = {},
): OtpReceivedPayload {
  return {
    port: 'COM3',
    phone: '0987654321',
    otp: '123456',
    message: 'Ma OTP cua ban la 123456',
    receivedAt: new Date('2026-08-11T07:00:00.000Z'),
    smsId: '42',
    ...overrides,
  };
}

function getSentBody(fetchMock: FetchMock): DiscordEmbedBody {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body) as DiscordEmbedBody;
}

describe('DiscordWebhookService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does nothing when DISCORD_WEBHOOK_URL is not configured', async () => {
    const fetchMock: FetchMock = jest.fn<
      Promise<{ ok: boolean; status: number }>,
      [string, { method: string; body: string }]
    >();
    global.fetch = fetchMock as never;

    const service = makeService('');
    await service.notify(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a Discord embed with the OTP details when configured', async () => {
    const fetchMock: FetchMock = jest
      .fn<
        Promise<{ ok: boolean; status: number }>,
        [string, { method: string; body: string }]
      >()
      .mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as never;

    const service = makeService('https://discord.com/api/webhooks/123/abc');
    await service.notify(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/123/abc');
    expect(init.method).toBe('POST');

    const body = getSentBody(fetchMock);
    expect(body.embeds).toHaveLength(1);
    // The OTP is the visual focal point — a big markdown heading in the
    // embed description, not squeezed into a small field.
    expect(body.embeds[0].description).toBe('# `123456`');
    expect(body.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '📱 Số điện thoại',
          value: '0987654321',
        }),
        expect.objectContaining({ name: '🔌 Cổng', value: 'COM3' }),
      ]),
    );
  });

  it('logs a warning but does not throw when the request fails', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as never;
    const logger = { warn: jest.fn() };
    const service = new DiscordWebhookService(
      {
        discordWebhookUrl: 'https://discord.com/api/webhooks/x',
        discordWebhookTimeoutMs: 5000,
      } as never,
      logger as never,
    );

    await expect(service.notify(makePayload())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('truncates very long message bodies to fit Discord field limits', async () => {
    const fetchMock: FetchMock = jest
      .fn<
        Promise<{ ok: boolean; status: number }>,
        [string, { method: string; body: string }]
      >()
      .mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as never;

    const service = makeService('https://discord.com/api/webhooks/123/abc');
    await service.notify(makePayload({ message: 'A'.repeat(2000) }));

    const body = getSentBody(fetchMock);
    const contentField = body.embeds[0].fields.find(
      (f) => f.name === '💬 Nội dung tin nhắn',
    );
    expect(contentField?.value.length).toBeLessThanOrEqual(1024);
  });
});
