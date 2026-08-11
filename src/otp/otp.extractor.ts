import { Injectable } from '@nestjs/common';

/** Keyword-led OTP patterns (highest confidence). */
const KEYWORD_PATTERNS: RegExp[] = [
  /(?:otp|mã\s*otp|ma\s*otp)\s*[:：#]?\s*(\d{4,8})/i,
  /(?:ma|mã)\s*(?:xác|xac)\s*(?:nhận|nhan|minh|thực|thuc|nhận)\s*[^0-9]{0,24}(\d{4,8})/i,
  /(?:verification|security|confirm(?:ation)?)\s*code\s*[:：#]?\s*(\d{4,8})/i,
  /(?:account\s*)?code\s+is\s*[:：]?\s*(\d{4,8})/i,
  // Google / Play Console: "G-123456 is your Google verification code."
  /\bg-(\d{4,8})\b/i,
  // Generic "NNNNNN is your <service> ... code" (Google, Facebook, Microsoft, Play Console, etc.)
  /\b(\d{4,8})\s+is\s+your\b(?:(?!\bcode\b).){0,60}\bcode\b/i,
  /(?:code|mã|ma|pin|passcode|password)\s*[:：#]?\s*(\d{4,8})/i,
  /(\d{4,8})\s*(?:là|la)\s*(?:mã|ma|otp|code)/i,
  /(?:là|la)\s*(\d{4,8})(?:\s|$|[,.])/i,
  /(?:use|using|enter|nhập|nhap)\s*(\d{4,8})\b/i,
  // Trailing hash anchor some providers append for autofill: "... #123456"
  /#(\d{4,8})\b/,
];

/** Notification-only SMS types — never contain OTP. */
const NON_OTP_NOTIFICATION =
  /(?:VNM-eTopup|eTopup).*(?:ma|mã)\s*giao\s*dich|(?:tai\s*khoan|tài\s*khoản).*(?:duoc|được)\s*nap/i;

/** Context before a number that indicates it is NOT an OTP. */
const EXCLUDE_BEFORE =
  /(?:lh|liên hệ|lien he|gọi|goi|gửi|gui|soạn|soan|sms|cuộc|hotline|tổng đài|tong dai|đến|den|call|gui tin|gửi tin|ma\s*giao\s*dich|mã\s*giao\s*dịch|giao\s*dich|giao\s*dịch|ma\s*don|mã\s*đơn|don\s*hang|đơn\s*hàng|order|ref(?:erence)?|tham\s*chiếu|tham\s*chieu|so\s*hoa\s*don|số\s*hóa\s*đơn)\s*$/i;

const HOTLINE_PATTERN = /^1[89]00\d{4,6}$/;
const VN_PHONE_PATTERN = /^(?:0|84)\d{8,10}$/;

@Injectable()
export class OtpExtractor {
  extract(message: string): string | null {
    const text = message.trim();
    if (!text) {
      return null;
    }

    if (NON_OTP_NOTIFICATION.test(text)) {
      return null;
    }

    for (const pattern of KEYWORD_PATTERNS) {
      const match = pattern.exec(text);
      if (match?.[1] && this.isPlausibleOtp(match[1], text, match.index)) {
        return match[1];
      }
    }

    const candidates = this.collectFallbackCandidates(text);
    if (!candidates.length) {
      return null;
    }

    return this.pickBestCandidate(candidates);
  }

  /**
   * When several plausible numbers remain, prefer the one repeated in the
   * message (providers like Google append the code twice, once inline and
   * once as an "#123456" autofill anchor) — that repetition is a much
   * stronger signal than position. Otherwise fall back to the earliest
   * occurrence, since the OTP normally leads the message while trailing
   * numbers tend to be order/reference ids appended afterwards.
   */
  private pickBestCandidate(
    candidates: Array<{ value: string; index: number }>,
  ): string {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1);
    }

    const maxCount = Math.max(...counts.values());
    if (maxCount > 1) {
      const repeated = candidates.find((c) => counts.get(c.value) === maxCount);
      if (repeated) {
        return repeated.value;
      }
    }

    return candidates[0].value;
  }

  private collectFallbackCandidates(
    text: string,
  ): Array<{ value: string; index: number }> {
    const results: Array<{ value: string; index: number }> = [];
    const pattern = /\b(\d{5,8})\b/g;

    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      const index = match.index ?? 0;
      if (this.isPlausibleOtp(value, text, index)) {
        results.push({ value, index });
      }
    }

    return results;
  }

  private isPlausibleOtp(value: string, text: string, index: number): boolean {
    if (!/^\d{4,8}$/.test(value)) {
      return false;
    }

    if (HOTLINE_PATTERN.test(value) || VN_PHONE_PATTERN.test(value)) {
      return false;
    }

    if (value.length === 4 && this.isLikelyShortcode(value, text, index)) {
      return false;
    }

    const before = text.slice(Math.max(0, index - 24), index);
    if (EXCLUDE_BEFORE.test(before)) {
      return false;
    }

    const after = text.slice(index + value.length, index + value.length + 8);
    if (/^\s*(?:đ|vnd|dong)/i.test(after)) {
      return false;
    }

    if (/^\.\d{4,}/.test(after)) {
      return false;
    }

    if (this.looksLikeTransactionDate(value)) {
      return false;
    }

    return true;
  }

  private looksLikeTransactionDate(value: string): boolean {
    if (!/^20\d{6}$/.test(value)) {
      return false;
    }

    const month = Number.parseInt(value.slice(4, 6), 10);
    const day = Number.parseInt(value.slice(6, 8), 10);

    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  }

  private isLikelyShortcode(
    value: string,
    text: string,
    index: number,
  ): boolean {
    const before = text.slice(Math.max(0, index - 16), index).toLowerCase();
    if (/(?:gửi|gui|soạn|soan|sms|nhắn|nhan)\s*$/i.test(before)) {
      return true;
    }

    const knownShortcodes = new Set([
      '1899',
      '8777',
      '8080',
      '9029',
      '1414',
      '1919',
      '8888',
      '9999',
    ]);
    return knownShortcodes.has(value);
  }
}
