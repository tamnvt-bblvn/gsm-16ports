(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DashboardHelpers = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizePhoneInput(value) {
    let digits = String(value ?? '').replace(/[\s\-().+]/g, '');
    if (digits.startsWith('84') && digits.length >= 11) {
      digits = `0${digits.slice(2)}`;
    }
    if (!digits.startsWith('0') && /^\d{9,10}$/.test(digits)) {
      digits = `0${digits}`;
    }
    return digits;
  }

  function isValidPhone(value) {
    return /^0\d{9,10}$/.test(value);
  }

  function pickSmsOtpCode(sms) {
    if (!sms || typeof sms !== 'object') {
      return null;
    }
    const code = sms.otpCode ?? sms.otp ?? null;
    if (code == null || code === '') {
      return null;
    }
    return String(code);
  }

  function shouldPrependLiveSms(smsMode) {
    return smsMode === 'live';
  }

  // Real SMS senders are phone numbers (<=15 digits, E.164) or short
  // alphanumeric IDs (brand names, service short codes like "195"). Some
  // modems occasionally mis-decode the sender field into a long digit
  // string that isn't a real address — surfacing that prominently in the
  // UI as if it were the sender is misleading, so we filter it out here.
  function isDisplayableSender(sender) {
    if (sender == null) return false;
    const trimmed = String(sender).trim();
    return trimmed.length > 0 && trimmed.length <= 20;
  }

  // Telcos frequently split one long SMS into several parts that arrive
  // seconds apart from the same port/sender. Shown as separate rows they
  // read as unrelated noise, so we stitch parts back into one thread when
  // they're close enough in time. `messages` must be chronological
  // (oldest first); groups come back in the same order.
  function groupSmsMessages(messages, windowMs = 20000) {
    const groups = [];
    for (const msg of Array.isArray(messages) ? messages : []) {
      const last = groups[groups.length - 1];
      const sender = msg?.sender ?? null;
      const receivedAtMs = new Date(msg?.receivedAt).getTime();
      const sameThread =
        last &&
        last.modemPort === msg?.modemPort &&
        last.sender === sender &&
        Math.abs(receivedAtMs - new Date(last.lastReceivedAt).getTime()) <= windowMs;

      if (sameThread) {
        last.message = `${last.message} ${msg.message}`.trim();
        last.otpCode = last.otpCode ?? msg.otpCode ?? null;
        last.lastReceivedAt = msg.receivedAt;
        last.partCount += 1;
        continue;
      }

      groups.push({
        modemPort: msg?.modemPort,
        sender,
        message: msg?.message ?? '',
        otpCode: msg?.otpCode ?? null,
        receivedAt: msg?.receivedAt,
        lastReceivedAt: msg?.receivedAt,
        partCount: 1,
      });
    }
    return groups;
  }

  // Vietnamese relative-time label for recent timestamps ("vừa xong", "5
  // phút trước"). Returns null once the gap passes a day so the caller
  // falls back to an absolute date instead of an unbounded "N giờ trước".
  function formatRelativeTime(value, nowMs = Date.now()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const diffMs = nowMs - date.getTime();
    if (diffMs < 0 || diffMs >= 24 * 60 * 60 * 1000) {
      return null;
    }
    if (diffMs < 10_000) {
      return 'vừa xong';
    }
    if (diffMs < 60_000) {
      return `${Math.floor(diffMs / 1000)} giây trước`;
    }
    if (diffMs < 60 * 60_000) {
      return `${Math.floor(diffMs / 60_000)} phút trước`;
    }
    return `${Math.floor(diffMs / (60 * 60_000))} giờ trước`;
  }

  return {
    normalizePhoneInput,
    isValidPhone,
    pickSmsOtpCode,
    shouldPrependLiveSms,
    groupSmsMessages,
    formatRelativeTime,
    isDisplayableSender,
  };
});
