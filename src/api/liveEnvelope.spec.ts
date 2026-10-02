// What liveEnvelope reads, checked without a client: the error envelope as errorFrom reads it
// (codes by status, values by type, Retry-After in its forms) and the sign-in answer guards. The
// wire spec pins that the client reads every answer through them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  envelopeOf,
  errorFrom,
  isLoginResult,
  isRefusal,
  isTokenPair,
  withCause,
} from './liveEnvelope';
import { MobileApiError } from './MobileApiError';
import type { MobileTokens } from './types';

const pair = (n: number): MobileTokens => ({
  tokenType: 'Bearer',
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  accessExpiresAt: '2026-10-01T12:15:00.000Z',
  refreshExpiresAt: '2026-10-31T12:00:00.000Z',
});
/** The error an answer that is not 2xx ends in: its status, its body as sent, its Retry-After. */
const answered = (status: number, raw: string, retryAfter: string | null = null) =>
  errorFrom(status, envelopeOf(raw), retryAfter, undefined);
/** The same, for a JSON body. */
const fromJson = (status: number, body: unknown, retryAfter: string | null = null) =>
  answered(status, JSON.stringify(body), retryAfter);

afterEach(() => {
  vi.useRealTimers();
});

describe('the error envelope', () => {
  it('treats a body that is not a JSON object as an empty envelope', () => {
    const gateway = answered(502, '<html>Bad gateway</html>');
    expect([gateway.code, gateway.status, gateway.message]).toEqual([
      'server_error',
      502,
      new MobileApiError('server_error', 502).message,
    ]);
    const missing = answered(404, '<html>Bad gateway</html>');
    expect([missing.code, missing.status]).toEqual(['request_failed', 404]);
    // A host's own 429 page still means slow down.
    const limited = answered(429, '<html>Slow down</html>', '9');
    expect([limited.code, limited.retryAfterSeconds]).toEqual(['rate_limited', 9]);
    const empty = answered(500, '');
    expect([empty.code, empty.status]).toEqual(['server_error', 500]);
    // JSON that is not an object has no envelope to read either.
    for (const raw of ['null', '[]', '"oops"', '42']) {
      const e = answered(503, raw);
      expect([e.code, e.status]).toEqual(['server_error', 503]);
    }
  });

  it('reads only what has the right type from the envelope', () => {
    const wrong = fromJson(409, {
      error: 7,
      message: 42,
      fields: ['x'],
      detail: 'x',
      retryAfterSeconds: 'soon',
    });
    expect([
      wrong.code,
      wrong.message,
      wrong.fields,
      wrong.detail,
      wrong.retryAfterSeconds,
    ]).toEqual(['request_failed', new MobileApiError('request_failed', 409).message, {}, [], null]);
    // An empty code is no code either.
    expect(fromJson(500, { error: '' }).code).toBe('server_error');
    const mixed = fromJson(400, {
      error: 'invalid_input',
      fields: { amountCents: 'Use whole cents.', rate: 3, note: null },
      detail: ['one', 'two'],
    });
    expect([mixed.fields, mixed.detail]).toEqual([
      { amountCents: 'Use whole cents.' },
      ['one', 'two'],
    ]);
    expect(fromJson(400, { error: 'weak_password', detail: ['one', 2] }).detail).toEqual([]);
  });

  it('falls back on a blank message', () => {
    const e = fromJson(403, { error: 'forbidden', message: '  ' });
    expect(e.message).toBe(new MobileApiError('forbidden', 403).message);
  });

  it('takes Retry-After from the body, else from the header as seconds or as a date', () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00.400Z'));
    const wait = (body: object, header: string | null = null) =>
      fromJson(429, body, header).retryAfterSeconds;
    const limited = { error: 'rate_limited' };
    expect(wait({ ...limited, retryAfterSeconds: 12 }, '30')).toBe(12);
    expect(wait({ ...limited, retryAfterSeconds: 'soon' }, '7')).toBe(7);
    // The body's value is read as the header's: whole seconds rounded up, never below 0.
    expect(wait({ ...limited, retryAfterSeconds: -5 }, '30')).toBe(30);
    expect(wait({ ...limited, retryAfterSeconds: 1.5 }, '30')).toBe(2);
    expect(wait(limited, '45')).toBe(45);
    // A date counts the whole seconds until then, rounded up so a retry is never early, and not
    // below 0 once it has passed.
    expect(wait(limited, 'Thu, 01 Oct 2026 12:01:30 GMT')).toBe(90);
    expect(wait(limited, 'Thu, 01 Oct 2026 11:59:00 GMT')).toBe(0);
    // 309 digits overflow to Infinity, which is no wait either.
    for (const unusable of ['soon', '-5', '1.5', '', 'Thu, soon', '9'.repeat(309)]) {
      expect(wait(limited, unusable)).toBeNull();
    }
    expect(wait(limited)).toBeNull();
    // A Retry-After on another answer, such as a 503, is read as well.
    expect(fromJson(503, { error: 'server_error' }, '120').retryAfterSeconds).toBe(120);
    // JSON can spell a number too big to be finite (1e999); that is no wait either.
    const huge = '{"error":"rate_limited","retryAfterSeconds":1e999}';
    expect(answered(429, huge, '7').retryAfterSeconds).toBe(7);
  });
});

describe('a refusal', () => {
  it('stays a refusal when it gains a cause, and a nameless page stays none', () => {
    const refused = fromJson(401, { error: 'session_revoked' });
    const failure = new DOMException('The database is closed', 'InvalidStateError');
    expect([isRefusal(refused), isRefusal(withCause(refused, failure))]).toEqual([true, true]);
    const page = answered(403, '<html>Forbidden</html>');
    expect([isRefusal(page), isRefusal(withCause(page, failure))]).toEqual([false, false]);
  });
});

describe('the sign-in answers', () => {
  // The session layer stores what sign-in answers, so it must be a session to store: the second
  // step answers the token pair (isTokenPair), the first a challenge or the pair (isLoginResult).
  it.each([
    ['loginTwoFactor', 'nothing', {}],
    ['loginTwoFactor', 'an empty access token', { ...pair(3), accessToken: '' }],
    ['loginTwoFactor', 'another token type', { ...pair(3), tokenType: 'MAC' }],
    ['login', 'nothing', {}],
    ['login', 'no tokens', { requiresTwoFactor: false }],
    ['login', 'no requiresTwoFactor', { ...pair(3) }],
    ['login', 'an empty refresh token', { requiresTwoFactor: false, ...pair(3), refreshToken: '' }],
    ['login', 'no challenge', { requiresTwoFactor: true }],
    ['login', 'an empty challenge', { requiresTwoFactor: true, challenge: '' }],
  ] as const)('refuses a %s answer with %s', (method, _what, answer) => {
    const guard = method === 'login' ? isLoginResult : isTokenPair;
    expect(guard(answer)).toBe(false);
  });

  it('takes the token pair, and a sign-in answer that is the pair or a challenge', () => {
    expect(isTokenPair(pair(3))).toBe(true);
    expect(isLoginResult({ requiresTwoFactor: false, ...pair(3) })).toBe(true);
    expect(isLoginResult({ requiresTwoFactor: true, challenge: 'c1' })).toBe(true);
  });
});
