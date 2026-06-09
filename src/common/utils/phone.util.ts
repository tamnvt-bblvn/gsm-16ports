export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) {
    return null;
  }

  let normalized = phone.replace(/[\s\-().]/g, '');

  if (normalized.startsWith('+84')) {
    normalized = `0${normalized.slice(3)}`;
  } else if (normalized.startsWith('84') && normalized.length >= 11) {
    normalized = `0${normalized.slice(2)}`;
  }

  if (!normalized.startsWith('0') && /^\d{9,10}$/.test(normalized)) {
    normalized = `0${normalized}`;
  }

  return normalized;
}

export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) {
    return false;
  }
  return left === right;
}
