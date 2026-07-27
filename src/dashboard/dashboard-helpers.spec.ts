// eslint-disable-next-line @typescript-eslint/no-require-imports
const helpers = require('./public/dashboard-helpers.js') as {
  normalizePhoneInput: (value: string) => string;
  isValidPhone: (value: string) => boolean;
  pickSmsOtpCode: (sms: unknown) => string | null;
  shouldPrependLiveSms: (smsMode: string) => boolean;
};

describe('dashboard-helpers', () => {
  describe('normalizePhoneInput', () => {
    it('normalizes +84 / 84 prefixes to local 0… form', () => {
      expect(helpers.normalizePhoneInput('+84 924 033 230')).toBe('0924033230');
      expect(helpers.normalizePhoneInput('84924033230')).toBe('0924033230');
    });
  });

  describe('isValidPhone', () => {
    it('accepts VN mobiles starting with 0', () => {
      expect(helpers.isValidPhone('0924033230')).toBe(true);
      expect(helpers.isValidPhone('924033230')).toBe(false);
    });
  });

  describe('pickSmsOtpCode', () => {
    it('prefers otpCode then otp', () => {
      expect(helpers.pickSmsOtpCode({ otpCode: '111111' })).toBe('111111');
      expect(helpers.pickSmsOtpCode({ otp: '222222' })).toBe('222222');
      expect(helpers.pickSmsOtpCode({})).toBeNull();
    });
  });

  describe('shouldPrependLiveSms', () => {
    it('only allows live mode', () => {
      expect(helpers.shouldPrependLiveSms('live')).toBe(true);
      expect(helpers.shouldPrependLiveSms('search')).toBe(false);
    });
  });
});
