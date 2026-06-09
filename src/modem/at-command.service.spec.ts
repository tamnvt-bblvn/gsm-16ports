import { AtCommandService } from './at-command.service';

describe('AtCommandService', () => {
  const service = new AtCommandService();

  describe('parseSimState', () => {
    it('detects READY SIM', () => {
      expect(service.parseSimState('+CPIN: READY\r\nOK')).toBe('ready');
    });

    it('detects NOT INSERTED SIM', () => {
      expect(service.parseSimState('+CPIN: NOT INSERTED\r\nOK')).toBe('absent');
    });

    it('detects CME ERROR 10 as absent', () => {
      expect(service.parseSimState('+CME ERROR: 10\r\n')).toBe('absent');
    });

    it('detects SIM PIN as other', () => {
      expect(service.parseSimState('+CPIN: SIM PIN\r\nOK')).toBe('other');
    });

    it('detects unknown CPIN response as other', () => {
      expect(service.parseSimState('+CPIN: SIM PUK\r\nOK')).toBe('other');
    });
  });

  describe('parseSimReady', () => {
    it('returns true only for READY', () => {
      expect(service.parseSimReady('+CPIN: READY\r\nOK')).toBe(true);
      expect(service.parseSimReady('+CPIN: NOT INSERTED\r\nOK')).toBe(false);
    });
  });
});
