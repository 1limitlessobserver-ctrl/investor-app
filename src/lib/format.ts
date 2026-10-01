// How the screens write money, percentages and dates. English (US) throughout; money arrives as
// integer cents. Intl formatters are slow to build and a figure can be formatted on every animation
// frame, so each one is built once.

const LOCALE = 'en-US';
/** What a date that cannot be read shows, so one bad value never breaks a screen. */
const NO_DATE = '—';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function built<T>(cache: Map<string, T>, key: string, create: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    value = create();
    cache.set(key, value);
  }
  return value;
}

function currencyFormat(currency: string): Intl.NumberFormat {
  return built(
    numberFormats,
    `currency:${currency}`,
    () => new Intl.NumberFormat(LOCALE, { style: 'currency', currency }),
  );
}

function compactFormat(currency: string): Intl.NumberFormat {
  // At most two decimals, none when they would be zeros: $999, $1.2M, $141.82K.
  return built(
    numberFormats,
    `compact:${currency}`,
    () =>
      new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        notation: 'compact',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
  );
}

function percentFormat(digits: number): Intl.NumberFormat {
  // `exceptZero` signs every figure but zero, and judges zero after rounding, so -0.04 reads 0.0%.
  return built(
    numberFormats,
    `percent:${digits}`,
    () =>
      new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: 'exceptZero',
      }),
  );
}

function dateFormat(timeZone: string | undefined, withYear: boolean): Intl.DateTimeFormat {
  return built(
    dateFormats,
    `${timeZone ?? ''}|${withYear}`,
    () =>
      new Intl.DateTimeFormat(LOCALE, {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' as const } : {}),
        timeZone,
      }),
  );
}

/** Integer cents as currency: 123456 is $1,234.56 and -5000 is -$50.00. */
function money(cents: number, currency = 'USD'): string {
  // Dividing -0 gives -0, which Intl would print as -$0.00.
  return currencyFormat(currency).format(cents === 0 ? 0 : cents / 100);
}

/** The short form for tight places: 123456789 is $1.23M and 99900 is $999. */
function moneyCompact(cents: number, currency = 'USD'): string {
  return compactFormat(currency).format(cents === 0 ? 0 : cents / 100);
}

/**
 * A percentage whose value is already in percent (12.345 is "12.3%"), with a fixed number of
 * decimals (one unless `digits` says otherwise) so columns of figures line up. `signed` puts a "+"
 * on gains; a loss always keeps its "-" and zero never has a sign.
 */
function percent(value: number, opts: { signed?: boolean; digits?: number } = {}): string {
  const { signed = false, digits = 1 } = opts;
  const text = percentFormat(digits).format(value);
  return `${signed ? text : text.replace(/^\+/, '')}%`;
}

/**
 * A calendar date such as "Sep 30, 2026", in the device's time zone unless `timeZone` names one.
 * A date-only value ("1980-04-12") is read as UTC midnight, so pass `{ timeZone: 'UTC' }` for those.
 */
function date(iso: string, opts: { timeZone?: string } = {}): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return NO_DATE;
  return dateFormat(opts.timeZone, true).format(when);
}

/**
 * How long ago something happened: "just now" under a minute, "5m ago", "3h ago", then "Yesterday"
 * (the previous UTC calendar day), then "Sep 20" or, from another year, "Sep 20, 2025". Days are UTC
 * days, like the platform's own periods. A time in the future (a fast clock) reads "just now" within
 * a minute and as a plain date beyond that.
 */
function relative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return NO_DATE;
  const elapsed = now.getTime() - then;
  if (elapsed >= -MINUTE) {
    if (elapsed < MINUTE) return 'just now';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
    if (Math.floor(now.getTime() / DAY) - Math.floor(then / DAY) === 1) return 'Yesterday';
  }
  const sameYear = new Date(then).getUTCFullYear() === now.getUTCFullYear();
  return dateFormat('UTC', !sameYear).format(then);
}

export const format = { money, moneyCompact, percent, date, relative };
