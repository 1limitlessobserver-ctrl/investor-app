import { describe, it, expect } from 'vitest';
import { createLiveApi, type StoredSession } from './createLiveApi';
import { MobileApiError } from './MobileApiError';
import type { MobileTokens } from './types';

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const pair = (n: number): MobileTokens => ({
  tokenType: 'Bearer',
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  accessExpiresAt: '2026-10-01T12:15:00.000Z',
  refreshExpiresAt: '2026-10-31T12:00:00.000Z',
});

function setup(
  script: (call: Call) => Response | Promise<Response>,
  initial: MobileTokens | null = pair(1),
) {
  const calls: Call[] = [];
  // The session a sign-in stored under its key; a rotation keeps the key and replaces the pair.
  let tokens: StoredSession | null = initial === null ? null : { sessionKey: 'k1', ...initial };
  const signedOut: string[] = [];
  const upgrades: string[] = [];
  const api = createLiveApi({
    baseUrl: 'https://platform.test/api/mobile/v1',
    tokenStore: {
      get: () => Promise.resolve(tokens),
      rotate: (t) => {
        if (tokens !== null) tokens = { sessionKey: tokens.sessionKey, ...t };
        return Promise.resolve();
      },
      clear: () => {
        tokens = null;
        return Promise.resolve();
      },
    },
    app: { version: '1.2.0', platform: 'web', deviceId: 'device-0001', deviceName: 'Ada’s laptop' },
    fetchImpl: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return script(call);
    }) as unknown as typeof fetch,
    onSignedOut: (r) => signedOut.push(r),
    onUpgradeRequired: (v) => upgrades.push(v),
  });
  return { api, calls, signedOut, upgrades, tokens: () => tokens };
}
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
async function failure(p: Promise<unknown>): Promise<MobileApiError> {
  try {
    await p;
  } catch (e) {
    if (MobileApiError.is(e)) return e;
    throw e;
  }
  throw new Error('expected a MobileApiError');
}

describe('createLiveApi', () => {
  it('sends the bearer token and the app headers', async () => {
    const t = setup(() => json(200, { id: 'u1' }));
    await t.api.me();
    expect(t.calls[0]!.url).toBe('https://platform.test/api/mobile/v1/me');
    expect(header(t.calls[0]!, 'Authorization')).toBe('Bearer a1');
    expect([
      header(t.calls[0]!, 'X-App-Version'),
      header(t.calls[0]!, 'X-App-Platform'),
      header(t.calls[0]!, 'X-Device-Id'),
    ]).toEqual(['1.2.0', 'web', 'device-0001']);
    expect(header(t.calls[0]!, 'X-Device-Name')).toBe('Ada%E2%80%99s%20laptop');
    expect(t.calls[0]!.init.credentials).toBe('omit');
  });

  it('refreshes once and retries when the access token expired', async () => {
    const t = setup((c) =>
      c.url.endsWith('/auth/refresh')
        ? json(200, pair(2))
        : header(c, 'Authorization') === 'Bearer a1'
          ? json(401, { error: 'unauthorized' })
          : json(200, { id: 'u1' }),
    );
    expect((await t.api.me()).id).toBe('u1');
    expect(t.calls.map((c) => c.url.split('/v1')[1])).toEqual(['/me', '/auth/refresh', '/me']);
    expect(JSON.parse(t.calls[1]!.init.body as string)).toEqual({ refreshToken: 'r1' });
    expect(t.tokens()?.accessToken).toBe('a2');
  });

  it('shares one refresh between concurrent requests', async () => {
    const t = setup((c) =>
      c.url.endsWith('/auth/refresh')
        ? json(200, pair(2))
        : header(c, 'Authorization') === 'Bearer a1'
          ? json(401, { error: 'unauthorized' })
          : json(200, { id: 'u1' }),
    );
    await Promise.all([t.api.me(), t.api.dashboard(), t.api.notifications()]);
    expect(t.calls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBe(1);
    expect(t.signedOut).toEqual([]);
  });

  it('retries with the newer token when another request already refreshed', async () => {
    // a1 answers session_revoked (the platform replaced the session row after a refresh elsewhere) but by then the store holds a2
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = setup(async (c) => {
      if (header(c, 'Authorization') === 'Bearer a1') {
        await gate;
        return json(401, { error: 'session_revoked' });
      }
      return json(200, { id: 'u1' });
    });
    const first = t.api.me();
    await (
      t.api as unknown as { _test_setTokens: (p: MobileTokens) => Promise<void> }
    )._test_setTokens(pair(2));
    release();
    expect((await first).id).toBe('u1');
    expect(t.signedOut).toEqual([]);
    expect(t.calls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBe(0);
  });

  it('signs out when the session was revoked', async () => {
    const t = setup(() =>
      json(401, { error: 'session_revoked', message: 'This session has ended. Sign in again.' }),
    );
    expect((await failure(t.api.me())).code).toBe('session_revoked');
    expect(t.signedOut).toEqual(['session_revoked']);
    expect(t.tokens()).toBeNull();
  });

  it('signs out when the refresh is refused but keeps the session on a 5xx refresh', async () => {
    const refused = setup((c) =>
      c.url.endsWith('/auth/refresh')
        ? json(401, { error: 'session_revoked' })
        : json(401, { error: 'unauthorized' }),
    );
    expect((await failure(refused.api.me())).code).toBe('session_revoked');
    expect(refused.signedOut).toEqual(['refresh_failed']);
    expect(refused.tokens()).toBeNull();
    const flaky = setup((c) =>
      c.url.endsWith('/auth/refresh')
        ? json(503, { error: 'server_error' })
        : json(401, { error: 'unauthorized' }),
    );
    expect((await failure(flaky.api.me())).code).toBe('server_error');
    expect(flaky.signedOut).toEqual([]);
    expect(flaky.tokens()?.refreshToken).toBe('r1');
  });

  it('reports an outdated app', async () => {
    const t = setup(() =>
      json(426, { error: 'upgrade_required', minSupportedAppVersion: '1.3.0' }),
    );
    expect((await failure(t.api.me())).code).toBe('upgrade_required');
    expect(t.upgrades).toEqual(['1.3.0']);
  });

  it('maps the error envelope with field messages and Retry-After', async () => {
    const t = setup(() =>
      json(400, {
        error: 'invalid_input',
        message: 'Check the highlighted fields.',
        fields: { amountCents: 'Use whole cents.' },
      }),
    );
    const e = await failure(t.api.manualDeposit({ methodId: 'm1', amountCents: 12 }));
    expect([e.code, e.status, e.message, e.fields.amountCents]).toEqual([
      'invalid_input',
      400,
      'Check the highlighted fields.',
      'Use whole cents.',
    ]);
    const limited = setup(() => json(429, { error: 'rate_limited' }, { 'Retry-After': '30' }));
    expect((await failure(limited.api.me())).retryAfterSeconds).toBe(30);
  });

  it('reports a network failure as offline', async () => {
    const t = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const e = await failure(t.api.me());
    expect([e.code, e.status]).toEqual(['network', 0]);
  });

  it('logs out with the refresh token and always clears tokens', async () => {
    const t = setup(() => json(500, { error: 'server_error' }));
    await t.api.logout();
    expect(JSON.parse(t.calls[0]!.init.body as string)).toEqual({ refreshToken: 'r1' });
    expect(t.tokens()).toBeNull();
  });

  it('reads the statement CSV as text and sends a push subscription', async () => {
    const t = setup((c) =>
      c.url.includes('/statements/file')
        ? new Response('date,description\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          })
        : json(200, { ok: true }),
    );
    expect(await t.api.statementCsv('2026-09')).toBe('date,description\n');
    expect(t.calls[0]!.url).toBe(
      'https://platform.test/api/mobile/v1/statements/file?period=2026-09',
    );
    await t.api.pushSubscribe({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'p', auth: 'a' },
      platform: 'web',
    });
    expect(t.calls[1]!.url.endsWith('/push/subscribe')).toBe(true);
    expect(t.calls[1]!.init.method).toBe('POST');
  });

  it('calls brand without a token', async () => {
    const t = setup(() => json(200, { name: 'Northwind' }), null);
    expect((await t.api.brand()).name).toBe('Northwind');
    expect(header(t.calls[0]!, 'Authorization')).toBeNull();
  });
});
