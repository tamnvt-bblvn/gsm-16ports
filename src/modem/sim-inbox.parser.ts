import { Injectable } from '@nestjs/common';
import { decodeDeliverPdu } from '../common/utils/pdu.util';

export interface SimInboxMessage {
  index: number;
  sender: string;
  message: string;
  receivedAt: Date;
}

interface DecodedEntry {
  index: number;
  sender: string;
  text: string;
  receivedAt: Date;
  reference: number | null;
  partNumber: number | null;
  totalParts: number | null;
}

@Injectable()
export class SimInboxParser {
  /** Parses a PDU-mode AT+CMGL=4 response, reassembling concatenated SMS. */
  parseCmglResponse(lines: string[]): SimInboxMessage[] {
    const entries: DecodedEntry[] = [];
    let pendingIndex: number | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === 'OK' || /^AT\+CMGL/i.test(line)) {
        continue;
      }

      const header = /^\+CMGL:\s*(\d+),\d+,[^,]*,\d+/i.exec(line);
      if (header) {
        pendingIndex = Number.parseInt(header[1], 10);
        continue;
      }

      if (pendingIndex === null) {
        continue;
      }

      const decoded = decodeDeliverPdu(line);
      if (decoded) {
        entries.push({
          index: pendingIndex,
          sender: decoded.sender,
          text: decoded.text,
          receivedAt: decoded.timestamp,
          reference: decoded.reference,
          partNumber: decoded.partNumber,
          totalParts: decoded.totalParts,
        });
      }
      pendingIndex = null;
    }

    return this.reassemble(entries).filter(
      (item) => item.message.trim().length > 0,
    );
  }

  private reassemble(entries: DecodedEntry[]): SimInboxMessage[] {
    const singles: SimInboxMessage[] = [];
    const groups = new Map<string, DecodedEntry[]>();

    for (const entry of entries) {
      if (
        entry.reference === null ||
        entry.partNumber === null ||
        entry.totalParts === null
      ) {
        singles.push({
          index: entry.index,
          sender: entry.sender,
          message: entry.text,
          receivedAt: entry.receivedAt,
        });
        continue;
      }

      const key = `${entry.sender}:${entry.reference}:${entry.totalParts}`;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    const combined: SimInboxMessage[] = Array.from(groups.values()).map(
      (parts) => {
        const sorted = [...parts].sort(
          (a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0),
        );
        return {
          index: Math.min(...sorted.map((p) => p.index)),
          sender: sorted[0].sender,
          message: sorted.map((p) => p.text).join(''),
          receivedAt: sorted.reduce(
            (earliest, p) =>
              p.receivedAt < earliest ? p.receivedAt : earliest,
            sorted[0].receivedAt,
          ),
        };
      },
    );

    return [...singles, ...combined].sort((a, b) => a.index - b.index);
  }
}
