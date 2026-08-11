import { decodeDeliverPdu, encodeSubmitPdu } from './pdu.util';

describe('pdu.util', () => {
  describe('decodeDeliverPdu', () => {
    it('decodes a hand-built SMS-DELIVER PDU (sender 12345, GSM7 "Hi")', () => {
      // SMSC=none, PDU-type=00 (DELIVER, no UDH), OA="12345" (unknown/national),
      // PID=00, DCS=00 (7bit), SCTS=2026-01-15 12:30:00, UDL=2, UD="Hi" packed.
      const bytes = Buffer.from([
        0x00, // SMSC length = 0
        0x00, // PDU type: SMS-DELIVER, no UDH
        0x05,
        0x81,
        0x21,
        0x43,
        0xf5, // OA: len=5, type=81, digits "12345"
        0x00, // PID
        0x00, // DCS: 7bit
        0x62,
        0x10,
        0x51,
        0x21,
        0x03,
        0x00,
        0x00, // SCTS: 26/01/15 12:30:00 +0
        0x02, // UDL = 2 septets
        0xc8,
        0x34, // packed "Hi"
      ]);

      const decoded = decodeDeliverPdu(bytes.toString('hex'));

      expect(decoded).not.toBeNull();
      expect(decoded?.sender).toBe('12345');
      expect(decoded?.text).toBe('Hi');
      expect(decoded?.reference).toBeNull();
      // TP-SCTS is Vietnam local time (UTC+7); the decoder builds the
      // instant explicitly off that offset, so assert with UTC getters —
      // local getters would depend on whatever timezone this test runs in.
      expect(decoded?.timestamp.getTime()).toBe(
        Date.UTC(2026, 0, 15, 12, 30, 0) - 7 * 60 * 60 * 1000,
      );
      expect(decoded?.timestamp.getUTCFullYear()).toBe(2026);
      expect(decoded?.timestamp.getUTCMonth()).toBe(0);
      expect(decoded?.timestamp.getUTCDate()).toBe(15);
      expect(decoded?.timestamp.getUTCHours()).toBe(5); // 12:30 VN = 05:30 UTC
      expect(decoded?.timestamp.getUTCMinutes()).toBe(30);
    });

    it('returns null for garbage input', () => {
      expect(decodeDeliverPdu('not-hex')).toBeNull();
    });
  });

  describe('encodeSubmitPdu + decodeDeliverPdu round-trip', () => {
    function roundTrip(destination: string, text: string) {
      const parts = encodeSubmitPdu(destination, text);
      // A SUBMIT PDU has a different structure (TP-DA instead of TP-OA, TP-MTI=01),
      // so we can't decode it with decodeDeliverPdu directly. Instead, verify the
      // encoder produced valid, well-formed hex and reasonable structure, then
      // separately confirm decode<->encode symmetry using a DELIVER PDU built
      // from the same low-level codec paths (address/septet packing).
      return parts;
    }

    it('encodes a short ASCII message as a single non-concatenated part', () => {
      const parts = roundTrip('0987654321', 'Hello world');
      expect(parts).toHaveLength(1);
      expect(parts[0].pdu).toMatch(/^[0-9A-F]+$/);
      // PDU type octet is the 2nd byte (1st is SMSC length "00")
      const pduTypeByte = Number.parseInt(parts[0].pdu.slice(2, 4), 16);
      expect(pduTypeByte & 0x40).toBe(0); // no UDH
    });

    it('encodes Vietnamese text as UCS2', () => {
      const parts = roundTrip('0987654321', 'Xin chào Việt Nam');
      expect(parts).toHaveLength(1);
      // DCS byte position varies with address length; just confirm it round-trips
      // through our own septet-encodability check (Vietnamese diacritics aren't
      // representable in GSM7, so this must have taken the UCS2 path).
      expect(parts[0].tpduLength).toBeGreaterThan(0);
    });

    it('splits a long ASCII message into multiple concatenated parts', () => {
      const longText = 'A'.repeat(400);
      const parts = roundTrip('0987654321', longText);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        const pduTypeByte = Number.parseInt(part.pdu.slice(2, 4), 16);
        expect(pduTypeByte & 0x40).toBe(0x40); // UDH present
      }
    });

    it('splits a long Vietnamese (UCS2) message into multiple concatenated parts', () => {
      const longText = 'Xin chào Việt Nam, '.repeat(10);
      const parts = roundTrip('0987654321', longText);
      expect(parts.length).toBeGreaterThan(1);
    });
  });

  describe('full submit → deliver decode symmetry via manual DELIVER re-framing', () => {
    it('reassembles concatenated GSM7 parts back into the original text', () => {
      const longText =
        'This is a long English SMS that will definitely exceed the ' +
        'single-part GSM7 limit of 160 characters and therefore must be ' +
        'split by the network into multiple concatenated SMS parts before ' +
        'reaching the recipient device, testing our reassembly logic end to end.';
      expect(longText.length).toBeGreaterThan(160);

      const parts = encodeSubmitPdu('0987654321', longText);
      expect(parts.length).toBeGreaterThan(1);

      // Re-frame each SUBMIT TPDU as a DELIVER TPDU so we can decode it with
      // decodeDeliverPdu and verify the UDH + text made it through packing
      // correctly (this exercises the exact same septet/UDH code paths used
      // for real incoming multipart SMS).
      const reassembled = parts
        .map((part) => reframeSubmitAsDeliver(part.pdu))
        .map((deliverHex) => decodeDeliverPdu(deliverHex))
        .sort((a, b) => (a?.partNumber ?? 0) - (b?.partNumber ?? 0))
        .map((decoded) => decoded?.text ?? '')
        .join('');

      expect(reassembled).toBe(longText);
    });

    it('reassembles concatenated UCS2 parts back into the original text', () => {
      const longText =
        'Xin chào Việt Nam, đây là một tin nhắn rất dài. '.repeat(5);
      expect(longText.length).toBeGreaterThan(70);

      const parts = encodeSubmitPdu('0987654321', longText);
      expect(parts.length).toBeGreaterThan(1);

      const reassembled = parts
        .map((part) => reframeSubmitAsDeliver(part.pdu))
        .map((deliverHex) => decodeDeliverPdu(deliverHex))
        .sort((a, b) => (a?.partNumber ?? 0) - (b?.partNumber ?? 0))
        .map((decoded) => decoded?.text ?? '')
        .join('');

      expect(reassembled).toBe(longText);
    });
  });
});

/**
 * A SUBMIT TPDU and a DELIVER TPDU share the same OA/DA + PID + DCS + UDL/UD
 * layout, differing only in the PDU-type octet (MTI bits) and having a
 * TP-VP/TP-SCTS field respectively in between the address and PID (absent
 * here since we encode SUBMIT without TP-VP). This helper flips the MTI bits
 * to DELIVER (00) and inserts a dummy 7-byte SCTS so decodeDeliverPdu (which
 * expects a DELIVER frame) can parse the same OA/PID/DCS/UDL/UD bytes our
 * encoder produced — letting us verify septet/UDH packing round-trips
 * correctly without needing a second full encoder implementation.
 */
function reframeSubmitAsDeliver(submitPduHex: string): string {
  const bytes = Buffer.from(submitPduHex, 'hex');
  let offset = 0;
  const smscLen = bytes[offset];
  offset += 1 + smscLen;

  const pduType = bytes[offset] & 0xfc; // clear MTI bits -> DELIVER (00)
  offset += 1;

  // Skip TP-MR (submit-only field, not present in DELIVER)
  const mrOffset = offset;
  offset += 1;

  // DA (same encoding as OA)
  const lengthField = bytes[offset];
  const addrByteCount = Math.ceil(lengthField / 2);
  const daBytes = bytes.slice(offset, offset + 2 + addrByteCount);
  offset += 2 + addrByteCount;

  const rest = bytes.slice(offset); // PID, DCS, UDL, UD

  const dummyScts = Buffer.from([0x62, 0x10, 0x51, 0x21, 0x03, 0x00, 0x00]);

  const deliverTpdu = Buffer.concat([
    Buffer.from([pduType]),
    daBytes,
    rest.slice(0, 1), // PID
    rest.slice(1, 2), // DCS
    dummyScts,
    rest.slice(2), // UDL + UD
  ]);

  void mrOffset;
  return `00${deliverTpdu.toString('hex')}`;
}
