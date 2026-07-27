import { isComPortInRange, normalizeComPort } from './com-port.util';

describe('normalizeComPort', () => {
  it('trims and uppercases port names', () => {
    expect(normalizeComPort(' com3 ')).toBe('COM3');
    expect(normalizeComPort('COM35')).toBe('COM35');
  });
});

describe('isComPortInRange', () => {
  it('includes ports inside the configured range', () => {
    expect(isComPortInRange('COM3', 'COM3', 'COM18')).toBe(true);
    expect(isComPortInRange('COM18', 'COM3', 'COM18')).toBe(true);
    expect(isComPortInRange('COM10', 'COM3', 'COM18')).toBe(true);
  });

  it('excludes ports outside the range', () => {
    expect(isComPortInRange('COM2', 'COM3', 'COM18')).toBe(false);
    expect(isComPortInRange('COM35', 'COM3', 'COM18')).toBe(false);
  });
});
