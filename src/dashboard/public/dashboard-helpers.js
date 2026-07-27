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

  return {
    normalizePhoneInput,
    isValidPhone,
    pickSmsOtpCode,
    shouldPrependLiveSms,
  };
});
