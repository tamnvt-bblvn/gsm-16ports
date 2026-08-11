import { SimInboxParser } from './sim-inbox.parser';
import { encodeSubmitPdu } from '../common/utils/pdu.util';

/**
 * Builds a fake SMS-DELIVER PDU by re-framing one of our own SMS-SUBMIT
 * encodings (same OA/PID/DCS/UDL/UD layout, only the MTI bits and a
 * TP-SCTS field differ) — see the identical helper in pdu.util.spec.ts.
 */
function submitToDeliverPdu(submitPduHex: string): string {
  const bytes = Buffer.from(submitPduHex, 'hex');
  let offset = 0;
  const smscLen = bytes[offset];
  offset += 1 + smscLen;

  const pduType = bytes[offset] & 0xfc;
  offset += 1;
  offset += 1; // skip TP-MR

  const lengthField = bytes[offset];
  const addrByteCount = Math.ceil(lengthField / 2);
  const daBytes = bytes.slice(offset, offset + 2 + addrByteCount);
  offset += 2 + addrByteCount;

  const rest = bytes.slice(offset); // PID, DCS, UDL, UD
  const dummyScts = Buffer.from([0x62, 0x10, 0x51, 0x21, 0x03, 0x00, 0x00]);

  const deliverTpdu = Buffer.concat([
    Buffer.from([pduType]),
    daBytes,
    rest.slice(0, 1),
    rest.slice(1, 2),
    dummyScts,
    rest.slice(2),
  ]);

  return `00${deliverTpdu.toString('hex')}`;
}

describe('SimInboxParser', () => {
  const parser = new SimInboxParser();

  it('parses a single-part stored SMS from AT+CMGL=4 (PDU mode) response', () => {
    const pdu = submitToDeliverPdu(
      encodeSubmitPdu('0901234567', 'Your OTP code is 123456')[0].pdu,
    );

    const messages = parser.parseCmglResponse(['+CMGL: 1,1,,25', pdu, 'OK']);

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe('Your OTP code is 123456');
    expect(messages[0].sender).toBe('+84901234567');
  });

  it('reassembles a concatenated stored SMS split across multiple +CMGL entries', () => {
    const longText =
      'This is a long stored SMS that will definitely exceed the ' +
      'single-part GSM7 limit of 160 characters and therefore had to be ' +
      'split by the network into multiple concatenated SMS parts before ' +
      'reaching the SIM inbox, testing our sim-inbox reassembly logic end to end.';
    expect(longText.length).toBeGreaterThan(160);

    const parts = encodeSubmitPdu('0901234567', longText);
    expect(parts.length).toBeGreaterThan(1);

    const lines: string[] = [];
    parts.forEach((part, i) => {
      lines.push(`+CMGL: ${i + 1},1,,${part.tpduLength}`);
      lines.push(submitToDeliverPdu(part.pdu));
    });
    lines.push('OK');

    const messages = parser.parseCmglResponse(lines);

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe(longText);
    expect(messages[0].sender).toBe('+84901234567');
  });

  it('parses two independent single-part messages in the same batch', () => {
    const pdu1 = submitToDeliverPdu(
      encodeSubmitPdu('0901234567', 'Your OTP code is 123456')[0].pdu,
    );
    const pdu2 = submitToDeliverPdu(
      encodeSubmitPdu('0909999999', 'Ma xac nhan: 654321')[0].pdu,
    );

    const messages = parser.parseCmglResponse([
      '+CMGL: 1,1,,25',
      pdu1,
      '+CMGL: 2,1,,20',
      pdu2,
      'OK',
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0].message).toBe('Your OTP code is 123456');
    expect(messages[1].message).toBe('Ma xac nhan: 654321');
  });
});
