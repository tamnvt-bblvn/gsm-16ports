const HEX_ONLY = /^[0-9A-Fa-f]+$/;

/**
 * Detects GSM UCS2 (UTF-16BE) payloads returned as hex by many modems
 * for Vietnamese / Unicode SMS.
 */
export function isUcs2HexBody(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length % 4 !== 0) {
    return false;
  }
  if (!HEX_ONLY.test(trimmed)) {
    return false;
  }

  let highByte00 = 0;
  let nonAscii = 0;
  const units = trimmed.length / 4;

  for (let i = 0; i < trimmed.length; i += 4) {
    const code = Number.parseInt(trimmed.slice(i, i + 4), 16);
    if (Number.isNaN(code) || code > 0xffff) {
      return false;
    }
    if (code > 0x7f) {
      nonAscii += 1;
    }
    if (code <= 0xff) {
      highByte00 += 1;
    }
  }

  return nonAscii > 0 || highByte00 / units >= 0.5;
}

/** Decodes UCS2 hex to readable text; returns input unchanged when not UCS2 hex. */
export function decodeSmsBody(message: string): string {
  const trimmed = message.trim();
  if (!isUcs2HexBody(trimmed)) {
    return message;
  }

  let decoded = '';
  for (let i = 0; i < trimmed.length; i += 4) {
    decoded += String.fromCharCode(Number.parseInt(trimmed.slice(i, i + 4), 16));
  }
  return decoded;
}
