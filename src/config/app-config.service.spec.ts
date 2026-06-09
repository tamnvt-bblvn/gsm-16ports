import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';

function makeConfig(values: Record<string, unknown>): AppConfigService {
  const config = {
    get: <T>(key: string, fallback?: T) => (values[key] ?? fallback) as T,
  } as unknown as ConfigService;
  return new AppConfigService(config);
}

describe('AppConfigService', () => {
  it('parses comma-separated API keys and trims them', () => {
    const service = makeConfig({ API_KEYS: ' key-a , key-b ,, key-c ' });
    expect(service.apiKeys).toEqual(['key-a', 'key-b', 'key-c']);
  });

  it('returns "*" for wildcard CORS origins', () => {
    const service = makeConfig({ CORS_ORIGINS: '*' });
    expect(service.corsOrigins).toBe('*');
  });

  it('splits explicit CORS origins into a list', () => {
    const service = makeConfig({
      CORS_ORIGINS: 'https://a.com, https://b.com',
    });
    expect(service.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('coerces string booleans for API auth flag', () => {
    expect(makeConfig({ API_AUTH_ENABLED: 'true' }).apiAuthEnabled).toBe(true);
    expect(makeConfig({ API_AUTH_ENABLED: 'false' }).apiAuthEnabled).toBe(
      false,
    );
    expect(makeConfig({ API_AUTH_ENABLED: true }).apiAuthEnabled).toBe(true);
  });

  it('defaults swagger to enabled', () => {
    expect(makeConfig({}).swaggerEnabled).toBe(true);
  });
});
