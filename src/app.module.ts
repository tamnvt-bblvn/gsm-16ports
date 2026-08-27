import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { ModemModule } from './modem/modem.module';
import { ModemStatusModule } from './modem-status/modem-status.module';
import { OtpModule } from './otp/otp.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL ?? 'info';
const streams: pino.StreamEntry[] = [
  {
    stream: pino.destination({
      dest: path.join(logsDir, 'gsm-otp.log'),
      mkdir: true,
      sync: false,
    }),
  },
];

// Always mirror to stdout (not just outside production) so `pm2 logs`
// shows readable output directly — pm2 only captures what the process
// writes to stdout/stderr, and previously that stream was skipped in
// production, leaving `pm2 logs` empty and forcing a manual open of
// logs/gsm-otp.log to see anything.
streams.push({
  stream: pino.transport({
    target: 'pino-pretty',
    options: { singleLine: true },
  }),
});

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: logLevel,
        stream: pino.multistream(streams),
        autoLogging: {
          ignore: (req) => (req.url ?? '').startsWith('/api/health'),
        },
      },
    }),
    EventEmitterModule.forRoot(),
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        throttlers: [
          {
            ttl: appConfig.throttleTtlSeconds * 1000,
            limit: appConfig.throttleLimit,
          },
        ],
      }),
    }),
    PrismaModule,
    ModemModule,
    SmsModule,
    OtpModule,
    ModemStatusModule,
    HealthModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
