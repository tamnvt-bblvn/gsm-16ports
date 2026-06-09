import { Injectable } from '@nestjs/common';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class OtpService {
  constructor(private readonly smsService: SmsService) {}

  getLatestByPort(port: string) {
    return this.smsService.findLatestOtpByPort(port);
  }

  getLatestByPhone(phone: string) {
    return this.smsService.findLatestOtpByPhone(phone);
  }
}
