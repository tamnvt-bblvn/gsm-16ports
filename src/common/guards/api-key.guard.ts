import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly appConfig: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.appConfig.apiAuthEnabled) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided =
      (request.headers[API_KEY_HEADER] as string | undefined) ??
      this.extractBearer(request);

    const allowed = this.appConfig.apiKeys;
    if (!provided || !allowed.includes(provided)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }

  private extractBearer(request: Request): string | undefined {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim();
    }
    return undefined;
  }
}
