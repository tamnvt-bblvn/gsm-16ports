import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SMS_RECEIVED_EVENT } from '../common/events/app.events';
import { decodeDeliverPdu } from '../common/utils/pdu.util';

/** How long to wait for the remaining parts of a concatenated SMS before
 * giving up and emitting whatever arrived (best effort, avoids losing a
 * message forever if the network drops one part). */
const CONCAT_FLUSH_TIMEOUT_MS = 15_000;

interface PendingGroup {
  sender: string;
  receivedAt: Date;
  total: number;
  parts: Map<number, string>;
  timer: NodeJS.Timeout;
}

@Injectable()
export class SmsParser {
  private awaitingPduByPort = new Set<string>();
  private groups = new Map<string, PendingGroup>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectPinoLogger(SmsParser.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Feeds one raw line from the modem. Returns nothing — completed messages
   * (immediate single-part, or once a concatenated group is whole/timed out)
   * are emitted directly via SMS_RECEIVED_EVENT.
   */
  parseLine(port: string, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (/^\+CMT:/i.test(trimmed)) {
      this.awaitingPduByPort.add(port);
      return;
    }

    if (!this.awaitingPduByPort.has(port)) {
      return;
    }

    this.awaitingPduByPort.delete(port);
    this.handlePdu(port, trimmed);
  }

  private handlePdu(port: string, pduHex: string): void {
    const decoded = decodeDeliverPdu(pduHex);
    if (!decoded) {
      this.logger.warn({ port, pduHex }, 'sms.pdu_decode_failed');
      return;
    }

    if (
      decoded.reference === null ||
      decoded.totalParts === null ||
      decoded.partNumber === null
    ) {
      this.emit(port, decoded.sender, decoded.text, decoded.timestamp);
      return;
    }

    this.addPart(port, decoded);
  }

  private addPart(
    port: string,
    decoded: NonNullable<ReturnType<typeof decodeDeliverPdu>>,
  ): void {
    const key = `${port}:${decoded.sender}:${decoded.reference}`;
    let group = this.groups.get(key);

    if (!group) {
      group = {
        sender: decoded.sender,
        receivedAt: decoded.timestamp,
        total: decoded.totalParts!,
        parts: new Map(),
        timer: setTimeout(
          () => this.flushGroup(port, key, true),
          CONCAT_FLUSH_TIMEOUT_MS,
        ),
      };
      this.groups.set(key, group);
    }

    group.parts.set(decoded.partNumber!, decoded.text);
    if (decoded.timestamp < group.receivedAt) {
      group.receivedAt = decoded.timestamp;
    }

    if (group.parts.size >= group.total) {
      clearTimeout(group.timer);
      this.flushGroup(port, key, false);
    }
  }

  private flushGroup(port: string, key: string, timedOut: boolean): void {
    const group = this.groups.get(key);
    if (!group) {
      return;
    }
    this.groups.delete(key);

    const orderedText = Array.from({ length: group.total }, (_, i) => i + 1)
      .map((seq) => group.parts.get(seq) ?? '')
      .join('');

    if (timedOut) {
      this.logger.warn(
        {
          port,
          sender: group.sender,
          got: group.parts.size,
          expected: group.total,
        },
        'sms.concat_incomplete_flush',
      );
    }

    this.emit(port, group.sender, orderedText, group.receivedAt);
  }

  private emit(
    port: string,
    sender: string,
    message: string,
    receivedAt: Date,
  ): void {
    this.eventEmitter.emit(SMS_RECEIVED_EVENT, {
      port,
      sender,
      message,
      receivedAt,
    });
  }
}
