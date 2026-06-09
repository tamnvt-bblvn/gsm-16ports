import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { envValidationSchema } from './env.validation';
import { ModemConfigService } from './modem-config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
  providers: [ModemConfigService, AppConfigService],
  exports: [ModemConfigService, AppConfigService],
})
export class AppConfigModule {}
