import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModemManager } from './modem.manager';

describe('ModemManager.sendSms', () => {
  function makeManager() {
    return new ModemManager(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new EventEmitter2(),
      {} as never,
      { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    );
  }

  it('normalizes port before looking up the modem instance', async () => {
    const manager = makeManager();
    const sendSms = jest.fn().mockResolvedValue(7);
    (manager as unknown as { instances: Map<string, unknown> }).instances.set(
      'COM3',
      { sendSms },
    );

    await expect(
      manager.sendSms(' com3 ', '0901234567', 'hello'),
    ).resolves.toEqual({
      port: 'COM3',
      phone: '0901234567',
      reference: 7,
    });
    expect(sendSms).toHaveBeenCalledWith('0901234567', 'hello');
  });

  it('throws a clear error when modem is not connected', async () => {
    const manager = makeManager();
    await expect(manager.sendSms('COM9', '0901234567', 'hello')).rejects.toThrow(
      'Modem COM9 chưa kết nối',
    );
  });

  it('normalizes port in getState lookups', () => {
    const manager = makeManager();
    (manager as unknown as { instances: Map<string, unknown> }).instances.set(
      'COM3',
      {
        getState: () => ({
          port: 'COM3',
          status: 'online',
          signal: 20,
          operator: 'Viettel',
          simReady: true,
          phone: null,
          iccid: null,
          lastError: null,
        }),
      },
    );
    (manager as unknown as { modemConfigService: { getEntry: () => undefined; isPortEnabled: () => true; getPhoneOverride: () => undefined; getLabel: () => undefined } }).modemConfigService =
      {
        getEntry: () => undefined,
        isPortEnabled: () => true,
        getPhoneOverride: () => undefined,
        getLabel: () => undefined,
      };

    expect(manager.getState(' com3 ')?.port).toBe('COM3');
    expect(manager.getState('com3')?.status).toBe('online');
  });
});
