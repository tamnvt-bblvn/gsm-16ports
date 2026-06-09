import { decodeSmsBody, isUcs2HexBody } from './sms-body.util';

describe('sms-body.util', () => {
  const vietnameseHex =
    '002001111EC30020004E00481EAC004E0020004E0047004100590020006E006800E9002E';

  it('detects UCS2 hex bodies', () => {
    expect(isUcs2HexBody(vietnameseHex)).toBe(true);
    expect(isUcs2HexBody('Ma xac nhan: 123456')).toBe(false);
    expect(isUcs2HexBody('ABCD')).toBe(false);
  });

  it('decodes Vietnamese UCS2 hex to readable text', () => {
    expect(decodeSmsBody(vietnameseHex)).toBe(' để NHẬN NGAY nhé.');
  });

  it('decodes numeric OTP stored as UCS2 hex', () => {
    const otpHex = '003100320033003400350036';
    expect(decodeSmsBody(otpHex)).toBe('123456');
  });

  it('returns plain GSM7 text unchanged', () => {
    const plain = 'Your OTP code is 123456';
    expect(decodeSmsBody(plain)).toBe(plain);
  });
});
