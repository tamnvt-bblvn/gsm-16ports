import { Injectable } from '@nestjs/common';

@Injectable()
export class AtCommandService {
  parseSignal(response: string): number | null {
    const match = /\+CSQ:\s*(\d+),/.exec(response);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? null : value;
  }

  parseOperator(response: string): string | null {
    const quoted = /\+COPS:\s*\d+,\d+,"([^"]+)"/.exec(response);
    if (quoted?.[1]) {
      return this.normalizeOperatorName(quoted[1]);
    }

    const numeric = /\+COPS:\s*\d+,(\d+)/.exec(response);
    if (numeric?.[1]) {
      return numeric[1];
    }

    return null;
  }

  parseSimReady(response: string): boolean {
    return /\+CPIN:\s*READY/i.test(response);
  }

  parsePhoneNumber(response: string): string | null {
    const candidates: string[] = [];

    for (const line of response.split(/\r?\n/)) {
      if (!line.includes('+CNUM') && !line.includes('+CPBR')) {
        continue;
      }

      const quotedNumbers = [...line.matchAll(/"(\+?\d{9,15})"/g)].map(
        (match) => match[1],
      );
      candidates.push(...quotedNumbers);

      const looseNumbers = [...line.matchAll(/(?:\+84|0)\d{9,10}/g)].map(
        (match) => match[0],
      );
      candidates.push(...looseNumbers);
    }

    for (const candidate of candidates) {
      const normalized = this.normalizeDetectedPhone(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeDetectedPhone(value: string): string | null {
    const digits = value.replace(/[^\d+]/g, '');
    if (/^0\d{9,10}$/.test(digits)) {
      return digits;
    }
    if (/^\+84\d{9,10}$/.test(digits)) {
      return `0${digits.slice(3)}`;
    }
    if (/^84\d{9,10}$/.test(digits)) {
      return `0${digits.slice(2)}`;
    }
    return null;
  }

  private normalizeOperatorName(value: string): string {
    const trimmed = value.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts.every((part) => part === parts[0])) {
      return parts[0];
    }

    const half = Math.floor(parts.length / 2);
    if (
      parts.length % 2 === 0 &&
      parts.slice(0, half).join(' ') === parts.slice(half).join(' ')
    ) {
      return parts.slice(0, half).join(' ');
    }

    return trimmed;
  }

  isFinalResponse(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed === 'OK' ||
      trimmed === 'ERROR' ||
      /^\+CMS ERROR:/i.test(trimmed) ||
      /^\+CME ERROR:/i.test(trimmed)
    );
  }

  isUnsolicited(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('+CMT:') ||
      trimmed.startsWith('+CMTI:') ||
      trimmed.startsWith('RING')
    );
  }
}
