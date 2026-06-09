import { OtpExtractor } from './otp.extractor';

describe('OtpExtractor', () => {
  const extractor = new OtpExtractor();

  it('extracts OTP from keyword format', () => {
    expect(extractor.extract('OTP: 123456')).toBe('123456');
  });

  it('extracts OTP from Vietnamese keyword format', () => {
    expect(extractor.extract('Ma xac nhan cua ban la 654321')).toBe('654321');
  });

  it('extracts OTP from "la" pattern', () => {
    expect(extractor.extract('Ma OTP cua QTV la 831746 co hieu luc')).toBe('831746');
  });

  it('does not treat hotline numbers as OTP', () => {
    expect(
      extractor.extract('LH 18001090 (mien phi) de duoc tu van'),
    ).toBeNull();
  });

  it('does not treat SMS shortcodes as OTP', () => {
    expect(extractor.extract('Soan Y gui 1899 de nhan thong tin')).toBeNull();
  });

  it('does not treat money amounts context as OTP', () => {
    expect(
      extractor.extract('Ban duoc ung 5.000d su dung trong 24h'),
    ).toBeNull();
  });

  it('still extracts standalone OTP in generic message', () => {
    expect(extractor.extract('Your verification code is 442891. Do not share.')).toBe(
      '442891',
    );
  });

  it('extracts Apple OTP and ignores long sender prefix', () => {
    expect(
      extractor.extract(
        "65112112108101: Your Apple Account Code is: 111856. Don't share it with anyone.",
      ),
    ).toBe('111856');
  });

  it('does not treat eTopup transaction id as OTP', () => {
    expect(
      extractor.extract(
        '127: []<VNM-eTopup[]> Tai khoan cua ban da duoc nap 20.000 VND vao luc 11:10 04/06/2026. Ma giao dich 20260604.3011602628. Tran trong!',
      ),
    ).toBeNull();
  });

  it('does not treat dotted transaction id prefix as OTP', () => {
    expect(
      extractor.extract(
        'Ma giao dich 20260506.3011291250 hoan tat thanh cong.',
      ),
    ).toBeNull();
  });
});
