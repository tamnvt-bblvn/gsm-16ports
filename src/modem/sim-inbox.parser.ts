import { Injectable } from '@nestjs/common';
import { extractGsmTimestampFromLine } from '../common/utils/gsm-timestamp.util';

export interface SimInboxMessage {
  index: number;
  sender: string;
  message: string;
  receivedAt: Date;
}

@Injectable()
export class SimInboxParser {
  parseCmglResponse(lines: string[]): SimInboxMessage[] {
    const messages: SimInboxMessage[] = [];
    let current: Omit<SimInboxMessage, 'message'> | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === 'OK' || /^AT\+CMGL/i.test(line)) {
        continue;
      }

      const header = /^\+CMGL:\s*(\d+),"[^"]*","([^"]*)"/i.exec(line);
      if (header) {
        if (current) {
          messages.push({ ...current, message: '' });
        }

        current = {
          index: Number.parseInt(header[1], 10),
          sender: header[2] ?? '',
          receivedAt: extractGsmTimestampFromLine(line) ?? new Date(),
        };
        continue;
      }

      if (current) {
        messages.push({
          ...current,
          message: line,
        });
        current = null;
      }
    }

    if (current) {
      messages.push({ ...current, message: '' });
    }

    return messages.filter((item) => item.message.trim().length > 0);
  }
}
