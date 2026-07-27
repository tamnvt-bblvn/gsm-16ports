import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ModemStatusController } from '../../modem-status/modem-status.controller';
import { SmsController } from '../../sms/sms.controller';
import { OtpController } from '../../otp/otp.controller';
import { WaitOtpController } from '../../otp/wait-otp.controller';

describe('Dashboard public routes', () => {
  const reflector = new Reflector();

  it('marks modem and messages controllers as public', () => {
    expect(
      reflector.get(IS_PUBLIC_KEY, ModemStatusController),
    ).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, SmsController)).toBe(true);
  });

  it('keeps OTP automation controllers private', () => {
    expect(reflector.get(IS_PUBLIC_KEY, OtpController)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, WaitOtpController)).toBeUndefined();
  });
});
