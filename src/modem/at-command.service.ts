import { Injectable } from '@nestjs/common';

export type SimState = 'ready' | 'absent' | 'other';

export interface AtErrorInfo {
  type: 'cms_error' | 'cme_error' | 'generic_error' | 'timeout' | 'unknown';
  code: string | null;
  description: string;
  suggestion: string;
  raw: string;
}

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

  parseIccid(response: string): string | null {
    for (const line of response.split(/\r?\n/)) {
      // +CCID: 89840...  or  +ICCID: 89840...
      const prefixed = /\+(?:CCID|ICCID):\s*(\d{19,20})/.exec(line);
      if (prefixed?.[1]) {
        return prefixed[1];
      }

      // Some modems return raw ICCID without prefix
      const raw = /^\s*(\d{19,20})\s*$/.exec(line);
      if (raw?.[1]) {
        return raw[1];
      }
    }
    return null;
  }

  parseRegistration(response: string): {
    registered: boolean;
    roaming: boolean;
  } {
    const match = /\+CREG:\s*\d+,(\d+)/.exec(response);
    if (!match) {
      return { registered: false, roaming: false };
    }
    const stat = Number.parseInt(match[1], 10);
    // 1 = registered home, 5 = registered roaming
    return {
      registered: stat === 1 || stat === 5,
      roaming: stat === 5,
    };
  }

  parseMemoryCapacity(
    response: string,
  ): { used: number; total: number } | null {
    // Example response: +CPMS: "SM",20,50,"SM",20,50,"SM",20,50
    const match = /\+CPMS:\s*"[^"]+",(\d+),(\d+)/.exec(response);
    if (!match) {
      return null;
    }
    const used = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);

    if (Number.isNaN(used) || Number.isNaN(total)) {
      return null;
    }
    return { used, total };
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

  parseErrorCode(lines: string[]): AtErrorInfo | null {
    const joined = lines.join('\n');

    const cms = /\+CMS ERROR:\s*(\d+)/i.exec(joined);
    if (cms) {
      const code = cms[1];
      return {
        type: 'cms_error',
        code,
        description: this.describeCmsError(code),
        suggestion: this.getCmsErrorSuggestion(code),
        raw: joined,
      };
    }

    const cme = /\+CME ERROR:\s*(\d+)/i.exec(joined);
    if (cme) {
      const code = cme[1];
      return {
        type: 'cme_error',
        code,
        description: this.describeCmeError(code),
        suggestion: this.getCmeErrorSuggestion(code),
        raw: joined,
      };
    }

    if (/\bERROR\b/i.test(joined)) {
      return {
        type: 'generic_error',
        code: null,
        description: 'Modem trả lỗi ERROR chung',
        suggestion: 'Kiểm tra AT command có hợp lệ, SIM đã sẵn sàng chưa',
        raw: joined,
      };
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

  describeCmsError(code: string): string {
    const map: Record<string, string> = {
      '1': 'Số không xác định',
      '8': 'Nhà mạng từ chối',
      '10': 'Cuộc gọi bị chặn',
      '21': 'Quá ngắn hoặc thiếu data',
      '27': 'Đích không có',
      '28': 'Số không xác định',
      '29': 'Phân phối bị từ chối',
      '38': 'Mạng lỗi',
      '41': 'Tạm thời lỗi',
      '42': 'Quá tải',
      '69': 'Dịch vụ chưa kích hoạt',
      '96': 'Chuyển đổi không hợp lệ',
      '127': 'Lỗi interworking',
      '300': 'Lỗi thiết bị',
      '301': 'Mạng không hỗ trợ SMS',
      '302': 'Không được phép',
      '303': 'Không hỗ trợ',
      '304': 'PDU không hợp lệ',
      '305': 'Tham số không hợp lệ',
      '310': 'Chưa cắm SIM',
      '311': 'SIM yêu cầu PIN',
      '312': 'Cần PH-SIM PIN',
      '313': 'Lỗi SIM',
      '314': 'SIM bận',
      '315': 'SIM sai',
      '316': 'Cần SIM PUK',
      '320': 'Bộ nhớ đầy',
      '321': 'Không tìm thấy SMS',
      '322': 'Không đủ bộ nhớ',
      '330': 'Không có dịch vụ SMS',
      '331': 'Mạng lỗi',
      '332': 'Chưa đăng ký mạng',
      '340': 'Lỗi không rõ nguyên nhân',
      '500': 'Lỗi không xác định',
      '512': 'Địa chỉ không hợp lệ',
      '513': 'Lỗi nội bộ modem',
    };
    return map[code] ?? 'Lỗi SMS không xác định';
  }

  describeCmeError(code: string): string {
    const map: Record<string, string> = {
      '0': 'Lỗi thiết bị',
      '1': 'Chưa kết nối',
      '2': 'Chưa kết nối link',
      '3': 'Không gửi được (operation not allowed)',
      '4': 'Không gửi được (operation not supported)',
      '5': 'Cần PH-SIM PIN',
      '10': 'Chưa cắm SIM',
      '11': 'Cần PIN SIM',
      '12': 'Cần PUK SIM',
      '13': 'SIM failure',
      '14': 'Busy',
      '15': 'SIM sai',
      '16': 'PIN sai',
      '17': 'Cần SIM PIN2',
      '18': 'Cần SIM PUK2',
      '20': 'Lỗi bộ nhớ',
      '21': 'Chỉ mục không hợp lệ',
      '22': 'Không tìm thấy',
      '25': 'Ký tự không hợp lệ',
      '26': 'Chuỗi quá dài',
      '27': 'Ký tự không hợp lệ',
      '30': 'Không có dịch vụ mạng',
      '31': 'Lỗi timeout mạng',
      '32': 'Mạng không cho phép',
      '100': 'Lỗi không xác định',
      '103': 'Bộ nhớ SIM bị khóa',
      '106': 'Lỗi tham số',
      '107': 'Lỗi chỉ mục SIM',
      '111': 'SIM bị khóa',
      '112': 'Cần PUK',
      '132': 'Dịch vụ chưa kích hoạt',
    };
    return map[code] ?? 'Lỗi modem không xác định';
  }

  private getCmsErrorSuggestion(code: string): string {
    const map: Record<string, string> = {
      '1': 'Kiểm tra số nhận có đúng định dạng',
      '8': 'Kiểm tra SIM có bị khóa hoặc hết cước',
      '21': 'Nội dung SMS quá ngắn hoặc trống',
      '28': 'Số nhận không tồn tại, kiểm tra lại',
      '29': 'Người nhận chặn tin nhắn từ số này',
      '38': 'Thử lại sau vài phút, lỗi mạng tạm thời',
      '41': 'Thử lại sau vài phút',
      '42': 'Mạng đang quá tải, thử lại sau',
      '69': 'Liên hệ nhà mạng để kích hoạt dịch vụ SMS',
      '300': 'Khởi động lại modem',
      '301': 'Nhà mạng không hỗ trợ SMS trên SIM này',
      '302': 'Kiểm tra SIM có đăng ký dịch vụ SMS',
      '310': 'Cắm lại SIM hoặc kiểm tra khe SIM',
      '311': 'Nhập mã PIN SIM',
      '313': 'Thử rút/cắm lại SIM',
      '314': 'Đợi SIM xử lý xong, thử lại sau',
      '320': 'Xóa bớt tin nhắn trên SIM (bộ nhớ SIM đầy)',
      '321': 'SMS không có trên SIM',
      '322': 'Xóa bớt tin nhắn trên SIM',
      '330': 'Liên hệ nhà mạng kích hoạt dịch vụ SMS',
      '331': 'Kiểm tra sóng mạng, thử di chuyển vị trí',
      '332': 'SIM chưa đăng ký mạng, kiểm tra lại SIM',
      '500': 'Khởi động lại modem và thử lại',
      '512': 'Kiểm tra lại số nhận, đảm bảo đúng format',
      '513': 'Khởi động lại modem',
    };
    return map[code] ?? 'Kiểm tra SIM, sóng mạng và thử lại';
  }

  private getCmeErrorSuggestion(code: string): string {
    const map: Record<string, string> = {
      '0': 'Khởi động lại modem',
      '3': 'Lệnh không được phép, kiểm tra trạng thái SIM',
      '4': 'Modem không hỗ trợ tính năng này',
      '10': 'Cắm SIM vào khe',
      '11': 'Nhập mã PIN SIM',
      '12': 'Nhập mã PUK SIM',
      '13': 'Thử rút/cắm lại SIM',
      '14': 'Đợi modem xử lý xong, thử lại sau vài giây',
      '15': 'Sử dụng SIM tương thích',
      '16': 'Nhập lại mã PIN đúng',
      '20': 'Xóa bớt dữ liệu trên SIM',
      '30': 'Kiểm tra sóng mạng, thử di chuyển vị trí',
      '31': 'Kiểm tra mạng, thử lại sau',
      '32': 'Liên hệ nhà mạng, dịch vụ bị chặn',
      '100': 'Thử lại, nếu vẫn lỗi hãy khởi động lại modem',
      '111': 'SIM bị khóa, liên hệ nhà mạng',
      '132': 'Liên hệ nhà mạng kích hoạt dịch vụ',
    };
    return map[code] ?? 'Kiểm tra trạng thái SIM và modem';
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
