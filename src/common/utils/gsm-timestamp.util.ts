/** GSM timestamp token: 3 date fields + time (optional timezone suffix). */
const GSM_TIMESTAMP =
  /(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})/;

const SMS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365 * 3;
const SMS_MAX_FUTURE_MS = 1000 * 60 * 60 * 24 * 2;

function buildGsmDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  const date = new Date(
    2000 + year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );

  if (
    date.getFullYear() !== 2000 + year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function pickClosestToNow(candidates: Date[]): Date | null {
  if (candidates.length === 0) {
    return null;
  }

  const now = Date.now();
  return candidates.reduce((best, date) =>
    Math.abs(date.getTime() - now) < Math.abs(best.getTime() - now)
      ? date
      : best,
  );
}

function pickPlausibleSmsDate(candidates: Date[]): Date | null {
  const now = Date.now();
  const min = now - SMS_MAX_AGE_MS;
  const max = now + SMS_MAX_FUTURE_MS;

  const inWindow = candidates.filter((date) => {
    const time = date.getTime();
    return !Number.isNaN(time) && time >= min && time <= max;
  });

  if (inWindow.length === 1) {
    return inWindow[0];
  }

  if (inWindow.length > 1) {
    return pickClosestToNow(inWindow);
  }

  return pickClosestToNow(candidates);
}

/**
 * Parses GSM timestamps trying both yy/MM/dd (3GPP) and dd/MM/yy (many VN modems),
 * then picks the interpretation closest to "now".
 */
export function parseGsmTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const match = GSM_TIMESTAMP.exec(value);
  if (!match) {
    return null;
  }

  const [, a, b, c, hour, minute, second] = match;
  const n1 = Number.parseInt(a, 10);
  const n2 = Number.parseInt(b, 10);
  const n3 = Number.parseInt(c, 10);
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  const s = Number.parseInt(second, 10);

  const candidates: Date[] = [];

  const yyMmDd = buildGsmDate(n1, n2, n3, h, m, s);
  if (yyMmDd) {
    candidates.push(yyMmDd);
  }

  const ddMmYy = buildGsmDate(n3, n2, n1, h, m, s);
  if (ddMmYy && ddMmYy.getTime() !== yyMmDd?.getTime()) {
    candidates.push(ddMmYy);
  }

  return pickPlausibleSmsDate(candidates);
}

/** Pulls the first GSM timestamp token from an AT response line. */
export function extractGsmTimestampFromLine(line: string): Date | null {
  return parseGsmTimestamp(line);
}

function copyTime(from: Date, to: Date): Date {
  return new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate(),
    from.getHours(),
    from.getMinutes(),
    from.getSeconds(),
  );
}

/**
 * Reverses legacy dd/mm/yy mis-parsing of GSM yy/MM/dd timestamps.
 * Example: "26/01/29" stored as Jan 26 2029 → corrected to Jan 29 2026.
 */
export function fixSwappedGsmDate(misParsed: Date): Date | null {
  const storedYear = misParsed.getFullYear();
  if (storedYear < 2028) {
    return null;
  }

  const yy = misParsed.getDate();
  const mm = misParsed.getMonth();
  const dd = storedYear - 2000;

  if (yy < 0 || yy > 99 || dd < 1 || dd > 31) {
    return null;
  }

  return new Date(
    2000 + yy,
    mm,
    dd,
    misParsed.getHours(),
    misParsed.getMinutes(),
    misParsed.getSeconds(),
  );
}

/**
 * Reverses dd/MM/yy parsing when yy/MM/dd was intended.
 * Example: "26/05/27" stored as May 26 2027 → corrected to May 27 2026.
 */
export function fixDdMmYyMisParse(misParsed: Date): Date | null {
  const storedYear = misParsed.getFullYear();
  if (storedYear < 2020) {
    return null;
  }

  const yy = misParsed.getDate();
  const mm = misParsed.getMonth() + 1;
  const dd = storedYear - 2000;

  if (yy < 1 || yy > 99 || mm < 1 || mm > 12 || dd < 0 || dd > 99) {
    return null;
  }

  const corrected = buildGsmDate(
    yy,
    mm,
    dd,
    misParsed.getHours(),
    misParsed.getMinutes(),
    misParsed.getSeconds(),
  );

  return corrected ? copyTime(misParsed, corrected) : null;
}

/**
 * Fixes legacy dates where yy=06 was stored as year 2006 instead of 2026.
 * Example: Jun 26 2006 → Jun 26 2026.
 */
export function fixLegacyCenturyDate(misParsed: Date): Date | null {
  const year = misParsed.getFullYear();
  if (year < 2000 || year > 2015) {
    return null;
  }

  return new Date(
    year + 20,
    misParsed.getMonth(),
    misParsed.getDate(),
    misParsed.getHours(),
    misParsed.getMinutes(),
    misParsed.getSeconds(),
  );
}

function isSuspiciousStoredGsmDate(stored: Date): boolean {
  const year = stored.getFullYear();
  const currentYear = new Date().getFullYear();

  return year < 2020 || year > currentYear || year >= 2028;
}

export function correctStoredGsmDate(stored: Date): Date | null {
  if (!isSuspiciousStoredGsmDate(stored)) {
    return null;
  }

  const candidates = [
    fixSwappedGsmDate(stored),
    fixDdMmYyMisParse(stored),
    fixLegacyCenturyDate(stored),
  ].filter((date): date is Date => date !== null);

  const corrected = pickClosestToNow(candidates);
  if (!corrected || corrected.getTime() === stored.getTime()) {
    return null;
  }

  return corrected;
}
