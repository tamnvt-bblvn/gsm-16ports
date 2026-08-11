import { DashboardGateway } from './dashboard.gateway';
import { OtpExtractor } from '../otp/otp.extractor';
import type { SmsReceivedPayload } from '../common/events/app.events';

describe('DashboardGateway', () => {
  const extractor = new OtpExtractor();
  let gateway: DashboardGateway;
  let emit: jest.Mock;

  beforeEach(() => {
    gateway = new DashboardGateway(extractor);
    emit = jest.fn();
    gateway.server = { emit } as never;
  });

  it('emits sms.received with otpCode when message contains OTP', () => {
    const payload: SmsReceivedPayload = {
      port: 'COM3',
      sender: 'Viettel',
      message: 'Ma OTP cua ban la 123456',
      receivedAt: new Date('2026-07-27T04:00:00.000Z'),
    };

    gateway.handleSmsReceived(payload);

    expect(emit).toHaveBeenCalledWith(
      'sms.received',
      expect.objectContaining({
        port: 'COM3',
        otpCode: '123456',
        receivedAt: '2026-07-27T04:00:00.000Z',
      }),
    );
  });

  it('emits sms.received with null otpCode when no OTP', () => {
    const payload: SmsReceivedPayload = {
      port: 'COM3',
      sender: 'Bank',
      message: 'Tai khoan cua ban duoc nap 50,000d',
      receivedAt: new Date('2026-07-27T04:00:00.000Z'),
    };

    gateway.handleSmsReceived(payload);

    expect(emit).toHaveBeenCalledWith(
      'sms.received',
      expect.objectContaining({
        otpCode: null,
      }),
    );
  });

  it('forwards modem.removed to websocket clients', () => {
    gateway.handleModemRemoved({ port: 'COM5' });
    expect(emit).toHaveBeenCalledWith('modem.removed', { port: 'COM5' });
  });

  it('forwards sim.port_changed with ISO timestamps', () => {
    gateway.handleSimPortChanged({
      iccid: '8984012345678901234',
      previousPort: 'COM3',
      newPort: 'COM7',
      phone: '0987654321',
      previousSeenAt: new Date('2026-07-01T00:00:00.000Z'),
      detectedAt: new Date('2026-08-11T04:00:00.000Z'),
    });

    expect(emit).toHaveBeenCalledWith(
      'sim.port_changed',
      expect.objectContaining({
        iccid: '8984012345678901234',
        previousPort: 'COM3',
        newPort: 'COM7',
        previousSeenAt: '2026-07-01T00:00:00.000Z',
        detectedAt: '2026-08-11T04:00:00.000Z',
      }),
    );
  });
});
