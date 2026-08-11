import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { OtpController } from './otp.controller';
import { WaitOtpController } from './wait-otp.controller';
import { OtpService } from './otp.service';
import { OtpWebhookService } from './otp-webhook.service';
import { DiscordWebhookService } from './discord-webhook.service';
import { WaitOtpService } from './wait-otp.service';

@Module({
  imports: [SmsModule],
  controllers: [OtpController, WaitOtpController],
  providers: [
    OtpService,
    WaitOtpService,
    OtpWebhookService,
    DiscordWebhookService,
  ],
  exports: [OtpService, WaitOtpService],
})
export class OtpModule {}
