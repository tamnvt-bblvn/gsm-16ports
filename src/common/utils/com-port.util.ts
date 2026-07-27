/** Normalize COM port labels for map lookups (`com3` → `COM3`). */
export function normalizeComPort(port: string): string {
  return port.trim().toUpperCase();
}

/** Parse `COM12` → `12`. Returns null if the label is not a COM port. */
export function parseComPortNumber(port: string): number | null {
  const match = /^COM(\d+)$/i.exec(port.trim());
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

/** Inclusive COM range check (`COM3`…`COM18`). */
export function isComPortInRange(
  port: string,
  from: string,
  to: string,
): boolean {
  const num = parseComPortNumber(port);
  const fromNum = parseComPortNumber(from);
  const toNum = parseComPortNumber(to);
  if (num == null || fromNum == null || toNum == null) {
    return false;
  }
  const start = Math.min(fromNum, toNum);
  const end = Math.max(fromNum, toNum);
  return num >= start && num <= end;
}
