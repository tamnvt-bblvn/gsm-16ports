import { EventEmitter2 } from '@nestjs/event-emitter';
import { SmsParser } from './sms.parser';
import { encodeSubmitPdu } from '../common/utils/pdu.util';

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

  const rest = bytes.slice(offset);
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

interface EmittedSms {
  port: string;
  sender: string;
  message: string;
  receivedAt: Date;
}

function makeParser() {
  const eventEmitter = new EventEmitter2();
  const parser = new SmsParser(eventEmitter, {
    warn: jest.fn(),
    debug: jest.fn(),
  } as never);
  return { parser, eventEmitter };
}

describe('SmsParser (PDU mode +CMT)', () => {
  it('emits a single-part message immediately after the CMT header + PDU line', () => {
    const { parser, eventEmitter } = makeParser();
    const received = jest.fn<void, [EmittedSms]>();
    eventEmitter.on('sms.received', received);

    const pdu = submitToDeliverPdu(
      encodeSubmitPdu('0901234567', 'Your OTP code is 123456')[0].pdu,
    );

    parser.parseLine('COM3', '+CMT: ,25');
    parser.parseLine('COM3', pdu);

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0]).toMatchObject({
      port: 'COM3',
      sender: '+84901234567',
      message: 'Your OTP code is 123456',
    });
  });

  it('reassembles a concatenated live SMS delivered as separate +CMT events, regardless of arrival order', () => {
    const { parser, eventEmitter } = makeParser();
    const received = jest.fn<void, [EmittedSms]>();
    eventEmitter.on('sms.received', received);

    const longText =
      'This is a long live SMS that will definitely exceed the single-part ' +
      'GSM7 limit of 160 characters and therefore gets split by the network ' +
      'into multiple concatenated SMS parts delivered as separate +CMT events, ' +
      'testing our live reassembly logic end to end across arrival order.';
    const parts = encodeSubmitPdu('0901234567', longText);
    expect(parts.length).toBeGreaterThan(1);

    // Deliver parts out of order to prove reassembly sorts by part number.
    const shuffled = [...parts].reverse();
    for (const part of shuffled) {
      parser.parseLine('COM5', '+CMT: ,999');
      parser.parseLine('COM5', submitToDeliverPdu(part.pdu));
    }

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0]).toMatchObject({
      port: 'COM5',
      sender: '+84901234567',
      message: longText,
    });
  });

  it('keeps concatenated groups separate per port', () => {
    const { parser, eventEmitter } = makeParser();
    const received = jest.fn<void, [EmittedSms]>();
    eventEmitter.on('sms.received', received);

    const longText = 'B'.repeat(300);
    const parts = encodeSubmitPdu('0901234567', longText);
    expect(parts.length).toBeGreaterThan(1);

    // Same reference number could collide across ports if not port-scoped.
    for (const part of parts) {
      parser.parseLine('COM1', '+CMT: ,999');
      parser.parseLine('COM1', submitToDeliverPdu(part.pdu));
    }
    for (const part of parts) {
      parser.parseLine('COM2', '+CMT: ,999');
      parser.parseLine('COM2', submitToDeliverPdu(part.pdu));
    }

    expect(received).toHaveBeenCalledTimes(2);
    const ports = received.mock.calls.map((call) => call[0].port).sort();
    expect(ports).toEqual(['COM1', 'COM2']);
  });

  it('flushes an incomplete concatenated group after the timeout with whatever parts arrived', () => {
    jest.useFakeTimers();
    try {
      const { parser, eventEmitter } = makeParser();
      const received = jest.fn<void, [EmittedSms]>();
      eventEmitter.on('sms.received', received);

      const longText = 'C'.repeat(300);
      const parts = encodeSubmitPdu('0901234567', longText);
      expect(parts.length).toBeGreaterThanOrEqual(2);

      // Only deliver the first part; second part "lost".
      parser.parseLine('COM7', '+CMT: ,999');
      parser.parseLine('COM7', submitToDeliverPdu(parts[0].pdu));

      expect(received).not.toHaveBeenCalled();
      jest.advanceTimersByTime(15_000);
      expect(received).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
