import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route/controller as public so the global API key guard skips it.
 * Used for the dashboard, health checks and Swagger docs.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
