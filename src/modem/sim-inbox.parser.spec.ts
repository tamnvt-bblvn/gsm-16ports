import { SimInboxParser } from './sim-inbox.parser';

describe('SimInboxParser', () => {
  const parser = new SimInboxParser();

  it('parses stored SMS from AT+CMGL response', () => {
    const messages = parser.parseCmglResponse([
      '+CMGL: 1,"REC UNREAD","+84901234567","","24/06/08,14:00:00+28"',
      'Your OTP code is 123456',
      '+CMGL: 2,"REC READ","BANK","","24/06/08,13:58:00+28"',
      'Ma xac nhan: 654321',
      'OK',
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe('+84901234567');
    expect(messages[0].message).toBe('Your OTP code is 123456');
    expect(messages[1].message).toBe('Ma xac nhan: 654321');
  });
});
