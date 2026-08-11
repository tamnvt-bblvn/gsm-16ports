// eslint-disable-next-line @typescript-eslint/no-require-imports
const helpers = require('./public/dashboard-helpers.js') as {
  normalizePhoneInput: (value: string) => string;
  isValidPhone: (value: string) => boolean;
  pickSmsOtpCode: (sms: unknown) => string | null;
  shouldPrependLiveSms: (smsMode: string) => boolean;
  groupSmsMessages: (
    messages: Array<{
      modemPort: string;
      sender: string | null;
      message: string;
      otpCode: string | null;
      receivedAt: string;
    }>,
    windowMs?: number,
  ) => Array<{
    modemPort: string;
    sender: string | null;
    message: string;
    otpCode: string | null;
    receivedAt: string;
    lastReceivedAt: string;
    partCount: number;
  }>;
  formatRelativeTime: (value: string, nowMs?: number) => string | null;
  isDisplayableSender: (sender: unknown) => boolean;
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

  describe('groupSmsMessages', () => {
    it('merges consecutive same-port same-sender messages within the time window', () => {
      const groups = helpers.groupSmsMessages([
        {
          modemPort: 'COM48',
          sender: '195',
          message: 'Quy khach duoc cong them 600 diem.',
          otpCode: null,
          receivedAt: '2026-08-11T10:27:35.000Z',
        },
        {
          modemPort: 'COM48',
          sender: '195',
          message: 'y truy cap https://viettel.vn/tammi.',
          otpCode: null,
          receivedAt: '2026-08-11T10:27:37.000Z',
        },
        {
          modemPort: 'COM48',
          sender: '195',
          message: 'en he 198 (0d). Tran trong.',
          otpCode: null,
          receivedAt: '2026-08-11T10:27:40.000Z',
        },
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0].partCount).toBe(3);
      expect(groups[0].message).toBe(
        'Quy khach duoc cong them 600 diem. y truy cap https://viettel.vn/tammi. en he 198 (0d). Tran trong.',
      );
      expect(groups[0].receivedAt).toBe('2026-08-11T10:27:35.000Z');
      expect(groups[0].lastReceivedAt).toBe('2026-08-11T10:27:40.000Z');
    });

    it('keeps messages from different ports or senders separate', () => {
      const groups = helpers.groupSmsMessages([
        {
          modemPort: 'COM48',
          sender: '195',
          message: 'A',
          otpCode: null,
          receivedAt: '2026-08-11T10:00:00.000Z',
        },
        {
          modemPort: 'COM12',
          sender: '195',
          message: 'B',
          otpCode: null,
          receivedAt: '2026-08-11T10:00:01.000Z',
        },
      ]);

      expect(groups).toHaveLength(2);
    });

    it('does not merge messages further apart than the window', () => {
      const groups = helpers.groupSmsMessages(
        [
          {
            modemPort: 'COM48',
            sender: '195',
            message: 'A',
            otpCode: null,
            receivedAt: '2026-08-11T10:00:00.000Z',
          },
          {
            modemPort: 'COM48',
            sender: '195',
            message: 'B',
            otpCode: null,
            receivedAt: '2026-08-11T10:00:30.000Z',
          },
        ],
        20000,
      );

      expect(groups).toHaveLength(2);
    });

    it('carries the first non-null OTP code forward into the group', () => {
      const groups = helpers.groupSmsMessages([
        {
          modemPort: 'COM48',
          sender: '195',
          message: 'Ma OTP cua ban la',
          otpCode: null,
          receivedAt: '2026-08-11T10:00:00.000Z',
        },
        {
          modemPort: 'COM48',
          sender: '195',
          message: '482913',
          otpCode: '482913',
          receivedAt: '2026-08-11T10:00:02.000Z',
        },
      ]);

      expect(groups[0].otpCode).toBe('482913');
    });
  });

  describe('formatRelativeTime', () => {
    const now = new Date('2026-08-11T10:00:00.000Z').getTime();

    it('returns "vừa xong" for very recent timestamps', () => {
      expect(
        helpers.formatRelativeTime('2026-08-11T09:59:55.000Z', now),
      ).toBe('vừa xong');
    });

    it('returns minute-granularity labels', () => {
      expect(
        helpers.formatRelativeTime('2026-08-11T09:55:00.000Z', now),
      ).toBe('5 phút trước');
    });

    it('returns null once older than a day, so callers fall back to an absolute date', () => {
      expect(
        helpers.formatRelativeTime('2026-08-09T10:00:00.000Z', now),
      ).toBeNull();
    });

    it('returns null for future/invalid timestamps', () => {
      expect(
        helpers.formatRelativeTime('2026-08-11T10:00:05.000Z', now),
      ).toBeNull();
      expect(helpers.formatRelativeTime('not-a-date', now)).toBeNull();
    });
  });

  describe('isDisplayableSender', () => {
    it('accepts phone numbers and short alphanumeric IDs', () => {
      expect(helpers.isDisplayableSender('195')).toBe(true);
      expect(helpers.isDisplayableSender('5259')).toBe(true);
      expect(helpers.isDisplayableSender('Apple')).toBe(true);
      expect(helpers.isDisplayableSender('+84924033230')).toBe(true);
      expect(helpers.isDisplayableSender('Techcombank')).toBe(true);
    });

    it('rejects long digit strings that look like parser artifacts', () => {
      expect(
        helpers.isDisplayableSender('8410199104991111096971101907'),
      ).toBe(false);
    });

    it('rejects null, undefined, and empty values', () => {
      expect(helpers.isDisplayableSender(null)).toBe(false);
      expect(helpers.isDisplayableSender(undefined)).toBe(false);
      expect(helpers.isDisplayableSender('   ')).toBe(false);
    });
  });
});
