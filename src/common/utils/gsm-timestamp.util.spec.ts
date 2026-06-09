import {
  correctStoredGsmDate,
  fixDdMmYyMisParse,
  fixLegacyCenturyDate,
  fixSwappedGsmDate,
  parseGsmTimestamp,
} from './gsm-timestamp.util';

describe('gsm-timestamp.util', () => {
  it('parses yy/MM/dd per 3GPP', () => {
    const date = parseGsmTimestamp('26/01/29,16:05:52+32');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(0);
    expect(date!.getDate()).toBe(29);
  });

  it('prefers 2026 over 2006 for ambiguous modem timestamps', () => {
    const date = parseGsmTimestamp('06/06/26,00:11:54+32');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(5);
    expect(date!.getDate()).toBe(6);
  });

  it('parses dd/MM/yy style timestamps from VN modems', () => {
    const date = parseGsmTimestamp('26/06/26,00:11:54+32');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(5);
    expect(date!.getDate()).toBe(26);
  });

  it('prefers 2026 over 2027 for 26/05/27 modem timestamps', () => {
    const date = parseGsmTimestamp('26/05/27,16:36:35+32');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(4);
    expect(date!.getDate()).toBe(27);
  });

  it('returns null for invalid input', () => {
    expect(parseGsmTimestamp(undefined)).toBeNull();
    expect(parseGsmTimestamp('invalid')).toBeNull();
  });

  it('fixes legacy dd/mm/yy mis-parse to yy/MM/dd (2029 case)', () => {
    const wrong = new Date(2029, 0, 26, 15, 33, 24);
    const fixed = fixSwappedGsmDate(wrong);
    expect(fixed).not.toBeNull();
    expect(fixed!.getFullYear()).toBe(2026);
    expect(fixed!.getDate()).toBe(29);
  });

  it('fixes dd/MM/yy mis-parse (2027 → 2026)', () => {
    const wrong = new Date(2027, 4, 26, 16, 36, 35);
    const fixed = fixDdMmYyMisParse(wrong);
    expect(fixed).not.toBeNull();
    expect(fixed!.getFullYear()).toBe(2026);
    expect(fixed!.getMonth()).toBe(4);
    expect(fixed!.getDate()).toBe(27);
  });

  it('fixes legacy century bug (2006 → 2026)', () => {
    const wrong = new Date(2006, 5, 26, 0, 11, 54);
    const fixed = fixLegacyCenturyDate(wrong);
    expect(fixed).not.toBeNull();
    expect(fixed!.getFullYear()).toBe(2026);
    expect(fixed!.getMonth()).toBe(5);
    expect(fixed!.getDate()).toBe(26);
  });

  it('correctStoredGsmDate handles all legacy bugs', () => {
    expect(correctStoredGsmDate(new Date(2029, 0, 26))?.getFullYear()).toBe(
      2026,
    );
    expect(correctStoredGsmDate(new Date(2006, 4, 26))?.getFullYear()).toBe(
      2026,
    );

    const fixed2027 = correctStoredGsmDate(new Date(2027, 4, 26, 16, 36, 35));
    expect(fixed2027?.getFullYear()).toBe(2026);
    expect(fixed2027?.getDate()).toBe(27);
  });

  it('does not alter already-correct recent dates', () => {
    const correct = new Date(2026, 4, 27, 16, 36, 35);
    expect(correctStoredGsmDate(correct)).toBeNull();
  });
});
