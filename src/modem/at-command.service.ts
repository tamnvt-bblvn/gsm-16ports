import { Injectable } from '@nestjs/common';

export type SimState = 'ready' | 'absent' | 'other';

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
    return this.parseSimState(response) === 'ready';
  }

  parseSimState(response: string): SimState {
    const text = response.toUpperCase();

    if (/\+CPIN:\s*READY/.test(text)) {
      return 'ready';
    }

    if (
      /\+CPIN:\s*NOT\s+INSERTED/.test(text) ||
      /\+CME\s+ERROR:\s*10\b/.test(text) ||
      /\+CME\s+ERROR:\s*13\b/.test(text)
    ) {
      return 'absent';
    }

    if (/\+CPIN:/.test(text) || /\+CME\s+ERROR:/.test(text)) {
      return 'other';
    }

    return 'other';
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

  formatFailureMessage(lines: string[]): string {
    const joined = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | ');

    if (!joined) {
      return 'Modem không phản hồi';
    }

    const cms = /\+CMS ERROR:\s*(\d+)/i.exec(joined);
    if (cms) {
      return `CMS ERROR ${cms[1]} (${this.describeCmsError(cms[1])})`;
    }

    const cme = /\+CME ERROR:\s*(\d+)/i.exec(joined);
    if (cme) {
      return `CME ERROR ${cme[1]} (${this.describeCmeError(cme[1])})`;
    }

    if (/\bERROR\b/i.test(joined)) {
      return `Modem ERROR: ${joined}`;
    }

    return joined;
  }

  private describeCmsError(code: string): string {
    const map: Record<string, string> = {
      '300': 'Lỗi thiết bị',
      '302': 'Không được phép',
      '303': 'Không hỗ trợ',
      '310': 'Chưa cắm SIM',
      '311': 'SIM yêu cầu PIN',
      '313': 'Lỗi SIM',
      '320': 'Bộ nhớ đầy',
      '321': 'Không tìm thấy SMS',
      '322': 'Không đủ bộ nhớ',
      '330': 'Không có dịch vụ SMS',
      '500': 'Lỗi không xác định',
      '512': 'Địa chỉ không hợp lệ',
    };
    return map[code] ?? 'Lỗi SMS';
  }

  private describeCmeError(code: string): string {
    const map: Record<string, string> = {
      '3': 'Không gửi được (operation not allowed)',
      '4': 'Không gửi được (operation not supported)',
      '10': 'Chưa cắm SIM',
      '11': 'Cần PIN SIM',
      '13': 'SIM failure',
      '14': 'Busy',
      '30': 'Không có dịch vụ mạng',
    };
    return map[code] ?? 'Lỗi modem';
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
