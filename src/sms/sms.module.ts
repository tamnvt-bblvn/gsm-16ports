import { Module } from '@nestjs/common';
import { ModemModule } from '../modem/modem.module';
import { OtpExtractor } from '../otp/otp.extractor';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';

@Module({
  imports: [ModemModule],
  controllers: [SmsController],
  providers: [SmsService, OtpExtractor],
  exports: [SmsService, OtpExtractor],
})
export class SmsModule {}
