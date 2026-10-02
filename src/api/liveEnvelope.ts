// What the live client reads without touching the network or the store: the platform's answers,
// checked by type (token pairs, sign-in results, the sessions list), its error envelope and
// Retry-After, and the MobileApiErrors built from them or beside a failing token store.

import { MobileApiError } from './MobileApiError';
import type { LoginResult, MobileTokens, SessionView } from './types';

const isString = (value: unknown): value is string => typeof value === 'string';
/** A JSON object: not null, and not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringEntry = (entry: [string, unknown]): entry is [string, string] =>
  typeof entry[1] === 'string';
/** The value when it is a string that is not empty. */
export const textOf = (value: unknown): string | undefined =>
  isString(value) && value !== '' ? value : undefined;

/** A token pair to store a session from: Bearer tokens that are not empty, and their expiry. */
export const isTokenPair = (value: unknown): value is MobileTokens =>
  isRecord(value) &&
  value.tokenType === 'Bearer' &&
  textOf(value.accessToken) !== undefined &&
  textOf(value.refreshToken) !== undefined &&
  isString(value.accessExpiresAt) &&
  isString(value.refreshExpiresAt);

/** A sign-in answer: the challenge of the second step, or the token pair. */
export const isLoginResult = (value: unknown): value is LoginResult =>
  isRecord(value) &&
  (value.requiresTwoFactor === true
    ? textOf(value.challenge) !== undefined
    : value.requiresTwoFactor === false && isTokenPair(value));

/** The token pair and nothing else: the sign-in routes also answer `requiresTwoFactor`. */
export const pairOf = (t: MobileTokens): MobileTokens => ({
  tokenType: t.tokenType,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  accessExpiresAt: t.accessExpiresAt,
  refreshExpiresAt: t.refreshExpiresAt,
});

/** A 401 about the token that was sent: it expired (`unauthorized`) or its session ended. */
export type TokenProblem = MobileApiError & {
  readonly status: 401;
  readonly code: 'unauthorized' | 'session_revoked';
};
export const isTokenProblem = (e: unknown): e is TokenProblem =>
  MobileApiError.is(e) &&
  e.status === 401 &&
  (e.code === 'unauthorized' || e.code === 'session_revoked');

/** The errors whose code the platform named itself: an envelope with a non-empty `error`. */
const namedByPlatform = new WeakSet<MobileApiError>();

/**
 * The platform refused the refresh token itself (revoked, replayed, expired): a 4xx with a
 * platform error code, but 426 (update first) and 429 (slow down), which say nothing about the
 * token. A 4xx without a code is some host's or proxy's page and keeps the session. This is
 * narrower, on purpose, than the design's "a refresh refused with 4xx".
 */
export const isRefusal = (e: unknown): e is MobileApiError =>
  MobileApiError.is(e) &&
  namedByPlatform.has(e) &&
  e.status >= 400 &&
  e.status < 500 &&
  e.status !== 426 &&
  e.status !== 429;

/** The token store failed before the platform was asked anything. */
export const storageError = (cause: unknown): MobileApiError =>
  new MobileApiError('storage_error', 0, undefined, { cause });

/** The platform's verdict `e` again, with `cause` as what went wrong on this side besides. */
export const withCause = (e: MobileApiError, cause: unknown): MobileApiError =>
  new MobileApiError(e.code, e.status, e.message, {
    fields: e.fields,
    detail: e.detail,
    retryAfterSeconds: e.retryAfterSeconds,
    cause,
  });

/** The JSON value of a body, or undefined when it is not JSON (which JSON.parse never answers). */
export function jsonOf(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** An error answer's JSON object; empty when the body is not one, such as a host's HTML page. */
export function envelopeOf(raw: string): Record<string, unknown> {
  const parsed = jsonOf(raw);
  return isRecord(parsed) ? parsed : {};
}

/** The media types the statement may come as, parameters such as a charset aside. */
export const STATEMENT_TYPE = /^text\/(?:csv|plain)\s*(?:;|$)/i;

/** A sessions answer: the platform wraps the list as `{ sessions }`. */
export const hasSessions = (value: unknown): value is { sessions: SessionView[] } =>
  isRecord(value) && Array.isArray(value.sessions);

/** What an answer without a usable `error` is called: what a 426 or 429 is, else the platform's. */
const fallbackCode = (status: number): string =>
  status === 426
    ? 'upgrade_required'
    : status === 429
      ? 'rate_limited'
      : status >= 500
        ? 'server_error'
        : 'request_failed';

/** A wait in whole seconds: a finite number not below 0, rounded up so a retry is never early. */
const waitOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;

/**
 * A Retry-After header as a wait: digits are seconds (so many that they overflow are no wait), and
 * an HTTP date is the seconds until then, rounded up and not below 0. Anything else is null.
 */
function secondsOf(header: string | null): number | null {
  const text = header?.trim() ?? '';
  if (/^\d+$/.test(text)) return waitOf(Number(text));
  // Read as a date only in the forms that open with a day name and a comma (IMF-fixdate, "Wed, 21
  // Oct 2026 07:28:00 GMT", and RFC 850): Date.parse alone takes "-5" or "1.5" for a year. The
  // asctime form has no comma and reads as no wait.
  if (!/^[A-Za-z]{3,9},/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * The error an answer that is not 2xx ends in, taking from its envelope only what has the right
 * type. A field the call has another name for (`fieldNames`) is keyed by that name.
 */
export function errorFrom(
  status: number,
  envelope: Record<string, unknown>,
  retryAfter: string | null,
  fieldNames: ReadonlyMap<string, string> | undefined,
): MobileApiError {
  const { error, message, fields, detail, retryAfterSeconds } = envelope;
  const code = textOf(error);
  const e = new MobileApiError(code ?? fallbackCode(status), status, textOf(message), {
    fields: isRecord(fields)
      ? Object.fromEntries(
          Object.entries(fields)
            .filter(isStringEntry)
            .map(([key, text]): [string, string] => [fieldNames?.get(key) ?? key, text]),
        )
      : undefined,
    detail: Array.isArray(detail) && detail.every(isString) ? detail : undefined,
    retryAfterSeconds: waitOf(retryAfterSeconds) ?? secondsOf(retryAfter),
  });
  if (code !== undefined) namedByPlatform.add(e);
  return e;
}
