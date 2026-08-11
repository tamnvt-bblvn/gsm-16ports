/**
 * Minimal GSM 03.40 / 03.38 PDU codec for SMS-DELIVER (incoming) and
 * SMS-SUBMIT (outgoing), including concatenated-SMS (UDH) support.
 *
 * We switch the modem to PDU mode (AT+CMGF=0) specifically so that long
 * messages split by the network into multiple parts can be reassembled
 * using the real concatenation reference/part/total from the UDH — text
 * mode never exposes that information.
 */

/* ── Bit-level packing for the GSM 7-bit default alphabet ────────────── */

class BitWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  writeBits(value: number, bits: number): void {
    this.bitBuffer |= (value & ((1 << bits) - 1)) << this.bitCount;
    this.bitCount += bits;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  }

  writeByte(value: number): void {
    this.writeBits(value, 8);
  }

  finish(): Buffer {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return Buffer.from(this.bytes);
  }
}

/** Unpacks `count` 7-bit codes from a packed octet stream, LSB-first. */
function unpackSeptets(bytes: Buffer, count: number): number[] {
  const result: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = 0;

  while (result.length < count) {
    while (bitCount < 7 && byteIndex < bytes.length) {
      bitBuffer |= bytes[byteIndex] << bitCount;
      bitCount += 8;
      byteIndex += 1;
    }
    if (bitCount < 7) {
      break;
    }
    result.push(bitBuffer & 0x7f);
    bitBuffer >>= 7;
    bitCount -= 7;
  }

  return result;
}

/** Packs 7-bit codes, optionally preceded by raw header octets (UDH). */
function packSeptetsWithHeader(headerBytes: Buffer, codes: number[]): Buffer {
  const writer = new BitWriter();
  for (const byte of headerBytes) {
    writer.writeByte(byte);
  }
  const headerOctets = headerBytes.length;
  const fillBits = headerOctets > 0 ? (7 - ((headerOctets * 8) % 7)) % 7 : 0;
  if (fillBits > 0) {
    writer.writeBits(0, fillBits);
  }
  for (const code of codes) {
    writer.writeBits(code, 7);
  }
  return writer.finish();
}

function octetsToSeptetCount(octets: number): number {
  return Math.ceil((octets * 8) / 7);
}

/* ── GSM 7-bit default alphabet (3GPP TS 23.038) ──────────────────────── */

const GSM7_BASIC: string[] = [
  '@',
  '£',
  '$',
  '¥',
  'è',
  'é',
  'ù',
  'ì',
  'ò',
  'Ç',
  '\n',
  'Ø',
  'ø',
  '\r',
  'Å',
  'å',
  'Δ',
  '_',
  'Φ',
  'Γ',
  'Λ',
  'Ω',
  'Π',
  'Ψ',
  'Σ',
  'Θ',
  'Ξ',
  '\x1B',
  'Æ',
  'æ',
  'ß',
  'É',
  ' ',
  '!',
  '"',
  '#',
  '¤',
  '%',
  '&',
  "'",
  '(',
  ')',
  '*',
  '+',
  ',',
  '-',
  '.',
  '/',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '¡',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'Ä',
  'Ö',
  'Ñ',
  'Ü',
  '§',
  '¿',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'ä',
  'ö',
  'ñ',
  'ü',
  'à',
];

const GSM7_EXT: Record<number, string> = {
  0x0a: '\f',
  0x14: '^',
  0x28: '{',
  0x29: '}',
  0x2f: '\\',
  0x3c: '[',
  0x3d: '~',
  0x3e: ']',
  0x40: '|',
  0x65: '€',
};

const GSM7_BASIC_REVERSE = new Map<string, number>(
  GSM7_BASIC.map((char, index) => [char, index]),
);
const GSM7_EXT_REVERSE = new Map<string, number>(
  Object.entries(GSM7_EXT).map(([code, char]) => [char, Number(code)]),
);

function septetsToText(codes: number[]): string {
  let text = '';
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    if (code === 0x1b && i + 1 < codes.length) {
      i += 1;
      text += GSM7_EXT[codes[i]] ?? ' ';
    } else {
      text += GSM7_BASIC[code] ?? '';
    }
  }
  return text;
}

/** Returns septet codes for `text`, or null if it contains a char outside GSM7. */
function textToSeptetCodes(text: string): number[] | null {
  const codes: number[] = [];
  for (const char of text) {
    const basic = GSM7_BASIC_REVERSE.get(char);
    if (basic !== undefined) {
      codes.push(basic);
      continue;
    }
    const ext = GSM7_EXT_REVERSE.get(char);
    if (ext !== undefined) {
      codes.push(0x1b, ext);
      continue;
    }
    return null;
  }
  return codes;
}

/* ── UCS2 (UTF-16BE) ───────────────────────────────────────────────────── */

function decodeUcs2(bytes: Buffer): string {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return text;
}

function encodeUcs2FromCodePoints(codePoints: number[]): Buffer {
  const bytes: number[] = [];
  for (const code of codePoints) {
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  return Buffer.from(bytes);
}

/* ── Semi-octet (BCD) digits — used for addresses and timestamps ─────── */

const SEMI_OCTET_CHARS = '0123456789*#abc';

function decodeSemiOctetDigits(bytes: Buffer, digitCount: number): string {
  let digits = '';
  for (const byte of bytes) {
    digits += SEMI_OCTET_CHARS[byte & 0x0f] ?? '';
    digits += SEMI_OCTET_CHARS[(byte >> 4) & 0x0f] ?? '';
  }
  return digits.slice(0, digitCount);
}

function encodeSemiOctetDigits(digits: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < digits.length; i += 2) {
    const low = Number.parseInt(digits[i], 10) || 0;
    const high =
      i + 1 < digits.length ? Number.parseInt(digits[i + 1], 10) || 0 : 0x0f;
    bytes.push((high << 4) | low);
  }
  return Buffer.from(bytes);
}

function bcdSwap(byte: number): number {
  return (byte & 0x0f) * 10 + ((byte >> 4) & 0x0f);
}

function decodeTimestamp(bytes: Buffer): Date {
  const yy = bcdSwap(bytes[0]);
  const mm = bcdSwap(bytes[1]);
  const dd = bcdSwap(bytes[2]);
  const hh = bcdSwap(bytes[3]);
  const mi = bcdSwap(bytes[4]);
  const ss = bcdSwap(bytes[5]);
  return new Date(2000 + yy, mm - 1, dd, hh, mi, ss);
}

/* ── Address (originating/destination number) ─────────────────────────── */

function decodeAddress(
  bytes: Buffer,
  offset: number,
): { address: string; consumedBytes: number } {
  const lengthField = bytes[offset];
  const typeByte = bytes[offset + 1];
  const ton = (typeByte >> 4) & 0x07;
  const dataStart = offset + 2;

  if (ton === 0x05) {
    // Alphanumeric sender id (bank/service name) — 7-bit packed.
    const nibbleCount = lengthField;
    const byteCount = Math.ceil(nibbleCount / 2);
    const dataBytes = bytes.slice(dataStart, dataStart + byteCount);
    const septetCount = Math.floor((nibbleCount * 4) / 7);
    const codes = unpackSeptets(dataBytes, septetCount);
    return { address: septetsToText(codes), consumedBytes: 2 + byteCount };
  }

  const digitCount = lengthField;
  const byteCount = Math.ceil(digitCount / 2);
  const dataBytes = bytes.slice(dataStart, dataStart + byteCount);
  const digits = decodeSemiOctetDigits(dataBytes, digitCount);
  const prefix = ton === 0x01 ? '+' : '';
  return { address: prefix + digits, consumedBytes: 2 + byteCount };
}

function encodeAddress(phone: string): Buffer {
  let digits = phone.replace(/[^\d+]/g, '');
  let ton = 0x81; // unknown/national

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    ton = 0x91; // international
  } else if (digits.startsWith('0')) {
    digits = `84${digits.slice(1)}`;
    ton = 0x91;
  }

  const lengthDigits = digits.length;
  const bcd = encodeSemiOctetDigits(digits);
  return Buffer.concat([Buffer.from([lengthDigits, ton]), bcd]);
}

/* ── Concatenation (UDH) info element ─────────────────────────────────── */

interface ConcatInfo {
  reference: number;
  total: number;
  seq: number;
}

function parseConcatIe(udh: Buffer): ConcatInfo | null {
  let i = 0;
  while (i + 1 < udh.length) {
    const tag = udh[i];
    const len = udh[i + 1];
    const data = udh.slice(i + 2, i + 2 + len);
    if (tag === 0x00 && len === 3 && data.length === 3) {
      return { reference: data[0], total: data[1], seq: data[2] };
    }
    if (tag === 0x08 && len === 4 && data.length === 4) {
      return {
        reference: (data[0] << 8) | data[1],
        total: data[2],
        seq: data[3],
      };
    }
    i += 2 + len;
  }
  return null;
}

/* ── Data Coding Scheme ────────────────────────────────────────────────── */

type Alphabet = '7bit' | '8bit' | 'ucs2';

function decodeDcsAlphabet(dcs: number): Alphabet {
  if ((dcs & 0xc0) === 0x00) {
    const bits = dcs & 0x0c;
    if (bits === 0x08) return 'ucs2';
    if (bits === 0x04) return '8bit';
    return '7bit';
  }
  return '7bit';
}

/* ── Public API ────────────────────────────────────────────────────────── */

export interface DecodedDeliverPdu {
  sender: string;
  timestamp: Date;
  text: string;
  reference: number | null;
  partNumber: number | null;
  totalParts: number | null;
}

/** Decodes a single SMS-DELIVER PDU (as returned by +CMT / +CMGL in PDU mode). */
export function decodeDeliverPdu(pduHex: string): DecodedDeliverPdu | null {
  const cleaned = pduHex.trim().replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return null;
  }

  try {
    const bytes = Buffer.from(cleaned, 'hex');
    let offset = 0;

    const smscLen = bytes[offset];
    offset += 1 + smscLen;

    const pduType = bytes[offset];
    offset += 1;
    const hasUdh = (pduType & 0x40) !== 0;
    const mti = pduType & 0x03;
    if (mti !== 0x00) {
      return null; // not SMS-DELIVER
    }

    const oa = decodeAddress(bytes, offset);
    offset += oa.consumedBytes;

    offset += 1; // TP-PID
    const dcs = bytes[offset];
    offset += 1;

    const scts = bytes.slice(offset, offset + 7);
    offset += 7;
    const timestamp = decodeTimestamp(scts);

    const udl = bytes[offset];
    offset += 1;
    const udBytes = bytes.slice(offset);

    const alphabet = decodeDcsAlphabet(dcs);

    let reference: number | null = null;
    let partNumber: number | null = null;
    let totalParts: number | null = null;
    let headerOctets = 0;

    if (hasUdh) {
      const udhl = udBytes[0];
      headerOctets = 1 + udhl;
      const udh = udBytes.slice(1, 1 + udhl);
      const concat = parseConcatIe(udh);
      if (concat) {
        reference = concat.reference;
        totalParts = concat.total;
        partNumber = concat.seq;
      }
    }

    let text: string;
    if (alphabet === '7bit') {
      const codes = unpackSeptets(udBytes, udl);
      const headerSeptets = hasUdh ? octetsToSeptetCount(headerOctets) : 0;
      text = septetsToText(codes.slice(headerSeptets));
    } else if (alphabet === 'ucs2') {
      text = decodeUcs2(udBytes.slice(headerOctets, udl));
    } else {
      text = udBytes.slice(headerOctets, udl).toString('latin1');
    }

    return {
      sender: oa.address,
      timestamp,
      text,
      reference,
      partNumber,
      totalParts,
    };
  } catch {
    return null;
  }
}

export interface PduPart {
  /** Full PDU hex (SMSC prefix + TPDU) to send after AT+CMGS=<tpduLength>. */
  pdu: string;
  /** TPDU length in octets, excluding the SMSC prefix — the value AT+CMGS expects. */
  tpduLength: number;
}

const GSM7_SINGLE_MAX = 160;
const GSM7_MULTI_MAX = 153;
const UCS2_SINGLE_MAX = 70;
const UCS2_MULTI_MAX = 67;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildSubmitPart(
  daBuffer: Buffer,
  alphabet: '7bit' | 'ucs2',
  codes: number[],
  concat: ConcatInfo | null,
): PduPart {
  const hasUdh = concat !== null;
  const pduType = 0x01 | (hasUdh ? 0x40 : 0x00);
  const headerBytes = hasUdh
    ? Buffer.from([
        0x05,
        0x00,
        0x03,
        concat.reference,
        concat.total,
        concat.seq,
      ])
    : Buffer.alloc(0);

  let udBuffer: Buffer;
  let udl: number;
  let dcs: number;

  if (alphabet === '7bit') {
    udBuffer = packSeptetsWithHeader(headerBytes, codes);
    const headerSeptets = hasUdh ? octetsToSeptetCount(headerBytes.length) : 0;
    udl = headerSeptets + codes.length;
    dcs = 0x00;
  } else {
    const textBytes = encodeUcs2FromCodePoints(codes);
    udBuffer = Buffer.concat([headerBytes, textBytes]);
    udl = udBuffer.length;
    dcs = 0x08;
  }

  const tpdu = Buffer.concat([
    Buffer.from([pduType]),
    Buffer.from([0x00]), // TP-MR — modem assigns
    daBuffer,
    Buffer.from([0x00]), // TP-PID
    Buffer.from([dcs]),
    Buffer.from([udl]),
    udBuffer,
  ]);

  return {
    pdu: `00${tpdu.toString('hex')}`.toUpperCase(),
    tpduLength: tpdu.length,
  };
}

/**
 * Encodes an outgoing SMS as one or more SMS-SUBMIT PDUs. Splits into
 * concatenated parts (with a UDH concatenation IE) when the text doesn't
 * fit a single PDU, using GSM 7-bit when possible and UCS2 otherwise.
 */
export function encodeSubmitPdu(destination: string, text: string): PduPart[] {
  const daBuffer = encodeAddress(destination);
  const gsm7Codes = textToSeptetCodes(text);

  if (gsm7Codes && gsm7Codes.length <= GSM7_SINGLE_MAX) {
    return [buildSubmitPart(daBuffer, '7bit', gsm7Codes, null)];
  }

  if (!gsm7Codes) {
    const ucs2Codes = Array.from(text).map(
      (char) => char.codePointAt(0) ?? 0x3f,
    );
    if (ucs2Codes.length <= UCS2_SINGLE_MAX) {
      return [buildSubmitPart(daBuffer, 'ucs2', ucs2Codes, null)];
    }
  }

  const reference = Math.floor(Math.random() * 256);

  if (gsm7Codes) {
    const chunks = chunkArray(gsm7Codes, GSM7_MULTI_MAX);
    return chunks.map((chunk, i) =>
      buildSubmitPart(daBuffer, '7bit', chunk, {
        reference,
        total: chunks.length,
        seq: i + 1,
      }),
    );
  }

  const ucs2Codes = Array.from(text).map((char) => char.codePointAt(0) ?? 0x3f);
  const chunks = chunkArray(ucs2Codes, UCS2_MULTI_MAX);
  return chunks.map((chunk, i) =>
    buildSubmitPart(daBuffer, 'ucs2', chunk, {
      reference,
      total: chunks.length,
      seq: i + 1,
    }),
  );
}
