import { Injectable } from '@nestjs/common';
import { SmsReceivedPayload } from '../common/events/app.events';
import { extractGsmTimestampFromLine } from '../common/utils/gsm-timestamp.util';

interface PendingSmsHeader {
  sender: string;
  receivedAt: Date;
}

@Injectable()
export class SmsParser {
  private pendingByPort = new Map<string, PendingSmsHeader>();

  parseLine(port: string, line: string): SmsReceivedPayload | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const cmtMatch = /^\+CMT:\s*"([^"]*)"/i.exec(trimmed);
    if (cmtMatch) {
      const sender = cmtMatch[1] ?? '';
      this.pendingByPort.set(port, {
        sender,
        receivedAt: extractGsmTimestampFromLine(trimmed) ?? new Date(),
      });
      return null;
    }

    const pending = this.pendingByPort.get(port);
    if (!pending) {
      return null;
    }

    this.pendingByPort.delete(port);
    return {
      port,
      sender: pending.sender,
      message: trimmed,
      receivedAt: pending.receivedAt,
    };
  }
}
