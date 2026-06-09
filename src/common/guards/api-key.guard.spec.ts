import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService } from '../../config/app-config.service';
import { ApiKeyGuard } from './api-key.guard';

function makeContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(options: {
  authEnabled: boolean;
  keys?: string[];
  isPublic?: boolean;
}): ApiKeyGuard {
  const reflector = {
    getAllAndOverride: () => options.isPublic ?? false,
  } as unknown as Reflector;
  const appConfig = {
    apiAuthEnabled: options.authEnabled,
    apiKeys: options.keys ?? [],
  } as unknown as AppConfigService;
  return new ApiKeyGuard(reflector, appConfig);
}

describe('ApiKeyGuard', () => {
  it('allows all requests when auth is disabled', () => {
    const guard = makeGuard({ authEnabled: false });
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('allows public routes even when auth is enabled', () => {
    const guard = makeGuard({ authEnabled: true, isPublic: true });
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rejects requests without a valid key', () => {
    const guard = makeGuard({ authEnabled: true, keys: ['secret'] });
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a matching x-api-key header', () => {
    const guard = makeGuard({ authEnabled: true, keys: ['secret'] });
    expect(guard.canActivate(makeContext({ 'x-api-key': 'secret' }))).toBe(
      true,
    );
  });

  it('accepts a matching bearer token', () => {
    const guard = makeGuard({ authEnabled: true, keys: ['secret'] });
    expect(
      guard.canActivate(makeContext({ authorization: 'Bearer secret' })),
    ).toBe(true);
  });
});
