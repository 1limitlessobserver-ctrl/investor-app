// What the plan's twelve cases (createLiveApi.spec.ts) leave open: every method's request as the
// platform reads it, the error envelope read defensively, sign-in and sign-out, and the edges of
// the refresh rules. All of it runs through a fake fetchImpl; nothing inside the client is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveApi, ROUTES, type LiveApiConfig } from './createLiveApi';
import { MobileApiError } from './MobileApiError';
import type { PlatformApi } from './PlatformApi';
import type { KycSubmission, LegacyPlan, MobileTokens } from './types';

const BASE = 'https://platform.test/api/mobile/v1';
const RUNAWAY = 20;
const APP: LiveApiConfig['app'] = {
  version: '1.2.0',
  platform: 'web',
  deviceId: 'device-0001',
  deviceName: 'Ada’s laptop',
};

type Call = { url: string; init: RequestInit };
type Script = (call: Call) => Response | Promise<Response>;
type ApiMethod = keyof typeof ROUTES;

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
  script: Script,
  initial: MobileTokens | null = pair(1),
  options: { baseUrl?: string; app?: LiveApiConfig['app'] } = {},
) {
  const calls: Call[] = [];
  let tokens = initial;
  const signedOut: string[] = [];
  const upgrades: string[] = [];
  const api = createLiveApi({
    baseUrl: options.baseUrl ?? BASE,
    tokenStore: {
      get: () => Promise.resolve(tokens),
      set: (t) => {
        tokens = t;
        return Promise.resolve();
      },
    },
    app: options.app ?? APP,
    fetchImpl: ((url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      // A client that retries without end must fail a test, not hang the run (the client reads
      // this refusal as a lost connection, which ends every retry).
      if (calls.length > RUNAWAY) return Promise.reject(new TypeError('too many requests'));
      return Promise.resolve(script(call));
    }) as unknown as typeof fetch,
    onSignedOut: (reason) => signedOut.push(reason),
    onUpgradeRequired: (version) => upgrades.push(version),
  });
  return {
    api,
    calls,
    signedOut,
    upgrades,
    tokens: () => tokens,
    /** Changes the store behind the api's back, as another request or a sign-out would. */
    store: (t: MobileTokens | null) => {
      tokens = t;
    },
  };
}

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const bearer = (c: Call) => header(c, 'Authorization');
const path = (c: Call) => c.url.slice(BASE.length);
const isRefresh = (c: Call) => c.url.endsWith('/auth/refresh');
const bodyOf = (c: Call): unknown => JSON.parse(c.init.body as string);
const later = () => new Promise((resolve) => setTimeout(resolve, 25));
async function failure(p: Promise<unknown>): Promise<MobileApiError> {
  try {
    await p;
  } catch (e) {
    if (MobileApiError.is(e)) return e;
    throw e;
  }
  throw new Error('expected a MobileApiError');
}
/** A request that waits at the platform until `release()`, so the store can change meanwhile. */
function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('the request as it goes out', () => {
  it('asks for the statement CSV as text, and still reads its errors as JSON', async () => {
    const ok = setup(() => new Response('a,b\n', { status: 200 }));
    expect(await ok.api.statementCsv('2026-09')).toBe('a,b\n');
    expect(header(ok.calls[0]!, 'Accept')).toBe('text/csv, text/plain');
    const bad = setup(() =>
      json(400, { error: 'invalid_input', fields: { period: 'Use a period like 2026-06' } }),
    );
    expect((await failure(bad.api.statementCsv('nope'))).fields.period).toBe(
      'Use a period like 2026-06',
    );
  });

  it.each([undefined, ''])('leaves X-Device-Name out when the device name is %j', async (name) => {
    const app: LiveApiConfig['app'] = { ...APP, deviceName: name };
    const t = setup(() => json(200, {}), pair(1), { app });
    await t.api.me();
    expect(header(t.calls[0]!, 'X-Device-Name')).toBeNull();
    expect(header(t.calls[0]!, 'X-Device-Id')).toBe('device-0001');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const t = setup(() => json(200, {}), pair(1), { baseUrl: `${BASE}/` });
    await t.api.me();
    expect(t.calls[0]!.url).toBe(`${BASE}/me`);
  });

  it('reports itself as the live api', () => {
    expect(setup(() => json(200, {})).api.mode).toBe('live');
  });

  it('looks the default fetch up when a call is made, not when the api is made', async () => {
    const stub = vi.fn<typeof fetch>(() => Promise.resolve(json(200, { name: 'Northwind' })));
    const api = createLiveApi({
      baseUrl: BASE,
      tokenStore: { get: () => Promise.resolve(null), set: () => Promise.resolve() },
      app: APP,
    });
    vi.stubGlobal('fetch', stub);
    expect((await api.brand()).name).toBe('Northwind');
    expect(stub.mock.calls[0]?.[0]).toBe(`${BASE}/brand`);
    expect(stub.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('offers _test_setTokens in test mode only', () => {
    expect(setup(() => json(200, {})).api).toHaveProperty('_test_setTokens');
    vi.stubEnv('MODE', 'production');
    expect(setup(() => json(200, {})).api).not.toHaveProperty('_test_setTokens');
  });
});

describe('the routes', () => {
  type Row = {
    run: (api: PlatformApi) => Promise<unknown>;
    /** The request line the platform sees, query string included. */
    route: string;
    /** The JSON a POST sends. */
    body?: unknown;
  };
  const credentials = { email: 'ada@example.com', password: 'pw' };
  const second = { challenge: 'c1', code: '123456' };
  const password = { currentPassword: 'old' };
  const prefs = {
    deposit: true,
    withdrawal: true,
    referral: false,
    support: true,
    kyc: true,
    security: true,
    system: false,
  };
  const subscription = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'p', auth: 'a' },
    platform: 'web',
  } as const;
  const deposit = { methodId: 'm1', amountCents: 1200, reference: 'ref' };
  const transfer = { recipient: '$bob', amountCents: 300, pin: '1234' };
  const kyc = { legalName: 'Ada Lovelace' } as KycSubmission;
  const plan = { title: 'Plan' } as LegacyPlan;
  const person = { fullName: 'Bob', relationship: 'child', sharePercent: 50 } as const;

  // One row per PlatformApi method, each routed as the platform's handlers and MOBILE_API.md name
  // it (not read back from ROUTES), so a method added to the interface fails typecheck here.
  const wire: Record<ApiMethod, Row> = {
    login: {
      run: (a) => a.login(credentials),
      route: 'POST /auth/login',
      body: credentials,
    },
    loginTwoFactor: {
      run: (a) => a.loginTwoFactor(second),
      route: 'POST /auth/login/2fa',
      body: second,
    },
    refresh: {
      run: (a) => a.refresh(),
      route: 'POST /auth/refresh',
      body: { refreshToken: 'r1' },
    },
    logout: { run: (a) => a.logout(), route: 'POST /auth/logout', body: { refreshToken: 'r1' } },
    brand: { run: (a) => a.brand(), route: 'GET /brand' },
    me: { run: (a) => a.me(), route: 'GET /me' },
    setNotificationPrefs: {
      run: (a) => a.setNotificationPrefs(prefs),
      route: 'POST /me/notification-prefs',
      body: prefs,
    },
    changePassword: {
      run: (a) => a.changePassword({ currentPassword: 'old', newPassword: 'new' }),
      route: 'POST /me/password',
      body: { currentPassword: 'old', newPassword: 'new' },
    },
    setPin: {
      run: (a) => a.setPin({ currentPassword: 'old', pin: '1234' }),
      route: 'POST /me/pin',
      body: { currentPassword: 'old', pin: '1234' },
    },
    sessions: { run: (a) => a.sessions(), route: 'GET /me/sessions' },
    revokeSession: {
      run: (a) => a.revokeSession('s1'),
      route: 'POST /me/sessions/revoke',
      body: { sessionId: 's1' },
    },
    enrollTwoFactor: {
      run: (a) => a.enrollTwoFactor(password),
      route: 'POST /me/two-factor/enroll',
      body: password,
    },
    enableTwoFactor: {
      run: (a) => a.enableTwoFactor({ code: '123456' }),
      route: 'POST /me/two-factor/enable',
      body: { code: '123456' },
    },
    disableTwoFactor: {
      run: (a) => a.disableTwoFactor(password),
      route: 'POST /me/two-factor/disable',
      body: password,
    },
    closeAccount: { run: (a) => a.closeAccount(password), route: 'POST /me/close', body: password },
    dashboard: { run: (a) => a.dashboard(), route: 'GET /dashboard' },
    investments: { run: (a) => a.investments(), route: 'GET /investments' },
    investment: {
      run: (a) => a.investment('a&b=c'),
      route: 'GET /investments/detail?id=a%26b%3Dc',
    },
    strategies: { run: (a) => a.strategies(), route: 'GET /strategies' },
    history: { run: (a) => a.history(), route: 'GET /history' },
    statements: { run: (a) => a.statements('quarterly'), route: 'GET /statements?kind=quarterly' },
    statement: {
      run: (a) => a.statement('2026-Q3'),
      route: 'GET /statements/detail?period=2026-Q3',
    },
    statementCsv: {
      run: (a) => a.statementCsv('2026-09'),
      route: 'GET /statements/file?period=2026-09',
    },
    notifications: { run: (a) => a.notifications(25), route: 'GET /notifications?limit=25' },
    markRead: {
      run: (a) => a.markRead('n1'),
      route: 'POST /notifications/read',
      body: { id: 'n1' },
    },
    pushSubscribe: {
      run: (a) => a.pushSubscribe(subscription),
      route: 'POST /push/subscribe',
      body: subscription,
    },
    pushUnsubscribe: {
      run: (a) => a.pushUnsubscribe(subscription.endpoint),
      route: 'POST /push/unsubscribe',
      body: { endpoint: subscription.endpoint },
    },
    supportTickets: { run: (a) => a.supportTickets(2), route: 'GET /support/tickets?page=2' },
    openTicket: {
      run: (a) => a.openTicket({ subject: 'Hello', message: 'A question' }),
      route: 'POST /support/tickets',
      body: { subject: 'Hello', body: 'A question' },
    },
    ticket: { run: (a) => a.ticket('t1'), route: 'GET /support/ticket?id=t1' },
    replyTicket: {
      run: (a) => a.replyTicket({ id: 't1', message: 'More' }),
      route: 'POST /support/reply',
      body: { ticketId: 't1', body: 'More' },
    },
    depositMethods: { run: (a) => a.depositMethods(), route: 'GET /deposit/methods' },
    manualDeposit: {
      run: (a) => a.manualDeposit(deposit),
      route: 'POST /deposit/manual',
      body: deposit,
    },
    cardDeposit: {
      run: (a) => a.cardDeposit({ amountCents: 5000 }),
      route: 'POST /deposit/checkout',
      body: { amountCents: 5000 },
    },
    withdrawals: { run: (a) => a.withdrawals(), route: 'GET /withdrawals' },
    requestWithdrawal: {
      run: (a) => a.requestWithdrawal({ kind: 'position', investmentId: 'i1' }),
      route: 'POST /withdrawals',
      body: { kind: 'position', investmentId: 'i1' },
    },
    transfers: { run: (a) => a.transfers(), route: 'GET /transfers' },
    sendTransfer: {
      run: (a) => a.sendTransfer(transfer),
      route: 'POST /transfers',
      body: transfer,
    },
    invest: {
      run: (a) => a.invest({ planId: 'p1', amountCents: 10000 }),
      route: 'POST /invest',
      body: { planId: 'p1', amountCents: 10000 },
    },
    maturityChoice: {
      run: (a) => a.maturityChoice({ choice: 'REINVEST', planId: 'p1' }),
      route: 'POST /maturity-choice',
      body: { choice: 'REINVEST', planId: 'p1' },
    },
    kyc: { run: (a) => a.kyc(), route: 'GET /kyc' },
    submitKyc: { run: (a) => a.submitKyc(kyc), route: 'POST /kyc', body: kyc },
    legacyPlan: { run: (a) => a.legacyPlan(), route: 'GET /legacy-plan' },
    saveLegacyPlan: {
      run: (a) => a.saveLegacyPlan({ expectedRevision: 3, plan }),
      route: 'POST /legacy-plan',
      body: { expectedRevision: 3, plan },
    },
    previewLegacyPlan: {
      run: (a) => a.previewLegacyPlan(plan),
      route: 'POST /legacy-plan/preview',
      body: { plan },
    },
    beneficiaries: { run: (a) => a.beneficiaries(), route: 'GET /beneficiaries' },
    addBeneficiary: {
      run: (a) => a.addBeneficiary(person),
      route: 'POST /beneficiaries',
      body: person,
    },
    updateBeneficiary: {
      run: (a) => a.updateBeneficiary({ id: 'b1', ...person }),
      route: 'POST /beneficiaries/update',
      body: { id: 'b1', ...person },
    },
    removeBeneficiary: {
      run: (a) => a.removeBeneficiary('b1'),
      route: 'POST /beneficiaries/remove',
      body: { id: 'b1' },
    },
    oracleAsk: {
      run: (a) => a.oracleAsk({ question: 'How am I doing?' }),
      route: 'POST /oracle/ask',
      body: { question: 'How am I doing?' },
    },
  };
  const everyMethod = Object.keys(wire) as ApiMethod[];
  // The routes that never send the bearer; every other one sends it when a token is stored.
  const publicRoutes: ApiMethod[] = ['brand', 'login', 'loginTwoFactor', 'refresh'];
  // One answer that suits every method: a token pair for the sign-in and refresh routes, a list
  // for sessions().
  const anything = () =>
    json(200, { ...pair(9), requiresTwoFactor: false, ok: true, current: false, sessions: [] });

  it.each(everyMethod)(
    '%s sends one request, to its route, as the platform reads it',
    async (name) => {
      const t = setup(anything);
      const row = wire[name];
      await row.run(t.api);
      expect(t.calls).toHaveLength(1);
      const call = t.calls[0]!;
      const [verb, target] = row.route.split(' ') as [string, string];
      expect([call.init.method, call.url]).toEqual([verb, BASE + target]);
      // A POST sends its JSON and says so; a GET sends neither a body nor a content type.
      expect([
        header(call, 'Content-Type'),
        verb === 'POST' ? bodyOf(call) : call.init.body,
      ]).toEqual(verb === 'POST' ? ['application/json', row.body] : [null, undefined]);
      expect(bearer(call)).toBe(publicRoutes.includes(name) ? null : 'Bearer a1');
      expect([header(call, 'Accept'), call.init.credentials, call.init.cache]).toEqual([
        name === 'statementCsv' ? 'text/csv, text/plain' : 'application/json',
        'omit',
        'no-store',
      ]);
      expect(ROUTES[name]).toEqual({ method: verb, path: target.split('?')[0] });
    },
  );

  it('leaves out the query key and the body field that were not given', async () => {
    const t = setup(() => json(200, {}));
    await t.api.notifications();
    await t.api.supportTickets();
    await t.api.markRead();
    expect(t.calls.map(path)).toEqual([
      '/notifications',
      '/support/tickets',
      '/notifications/read',
    ]);
    expect(bodyOf(t.calls[2]!)).toEqual({});
  });

  it('answers what the interface promises: the unwrapped list, nothing, or the body', async () => {
    const t = setup(() =>
      json(200, { ok: true, current: true, sessionsRevoked: 2, sessions: [{ id: 's1' }] }),
    );
    expect(await t.api.sessions()).toEqual([{ id: 's1' }]);
    expect(await t.api.revokeSession('s1')).toMatchObject({ ok: true, current: true });
    const nothing: ApiMethod[] = [
      'changePassword',
      'setPin',
      'disableTwoFactor',
      'closeAccount',
      'pushSubscribe',
      'pushUnsubscribe',
      'replyTicket',
      'maturityChoice',
      'removeBeneficiary',
    ];
    for (const name of nothing) expect(await wire[name].run(t.api)).toBeUndefined();
  });
});

describe('the error envelope', () => {
  it('treats a body that is not JSON as an empty envelope', async () => {
    const page = (status: number) => () => new Response('<html>Bad gateway</html>', { status });
    const gateway = await failure(setup(page(502)).api.me());
    expect([gateway.code, gateway.status, gateway.message]).toEqual([
      'server_error',
      502,
      new MobileApiError('server_error', 502).message,
    ]);
    const missing = await failure(setup(page(404)).api.me());
    expect([missing.code, missing.status]).toEqual(['request_failed', 404]);
    const empty = await failure(setup(() => new Response(null, { status: 500 })).api.me());
    expect([empty.code, empty.status]).toEqual(['server_error', 500]);
  });

  it('reads only what has the right type from the envelope', async () => {
    const wrong = await failure(
      setup(() =>
        json(409, { error: 7, message: 42, fields: ['x'], detail: 'x', retryAfterSeconds: 'soon' }),
      ).api.me(),
    );
    expect([
      wrong.code,
      wrong.message,
      wrong.fields,
      wrong.detail,
      wrong.retryAfterSeconds,
    ]).toEqual(['request_failed', new MobileApiError('request_failed', 409).message, {}, [], null]);
    const mixed = await failure(
      setup(() =>
        json(400, {
          error: 'invalid_input',
          fields: { amountCents: 'Use whole cents.', rate: 3, note: null },
          detail: ['one', 'two'],
        }),
      ).api.me(),
    );
    expect([mixed.fields, mixed.detail]).toEqual([
      { amountCents: 'Use whole cents.' },
      ['one', 'two'],
    ]);
    const notStrings = await failure(
      setup(() => json(400, { error: 'weak_password', detail: ['one', 2] })).api.me(),
    );
    expect(notStrings.detail).toEqual([]);
  });

  it('falls back on a blank message', async () => {
    const e = await failure(setup(() => json(403, { error: 'forbidden', message: '  ' })).api.me());
    expect(e.message).toBe(new MobileApiError('forbidden', 403).message);
  });

  it('takes Retry-After from the body, else from the header as seconds or as a date', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00.400Z'));
    const wait = async (body: object, headers: Record<string, string> = {}) =>
      (await failure(setup(() => json(429, body, headers)).api.me())).retryAfterSeconds;
    const limited = { error: 'rate_limited' };
    expect(await wait({ ...limited, retryAfterSeconds: 12 }, { 'Retry-After': '30' })).toBe(12);
    expect(await wait({ ...limited, retryAfterSeconds: 'soon' }, { 'Retry-After': '7' })).toBe(7);
    expect(await wait(limited, { 'Retry-After': '45' })).toBe(45);
    // A date counts the whole seconds until then, rounded up so a retry is never early, and not
    // below 0 once it has passed.
    expect(await wait(limited, { 'Retry-After': 'Thu, 01 Oct 2026 12:01:30 GMT' })).toBe(90);
    expect(await wait(limited, { 'Retry-After': 'Thu, 01 Oct 2026 11:59:00 GMT' })).toBe(0);
    for (const unusable of ['soon', '-5', '1.5', '']) {
      expect(await wait(limited, { 'Retry-After': unusable })).toBeNull();
    }
    expect(await wait(limited)).toBeNull();
  });

  it('tells onUpgradeRequired the version a 426 names, or an empty one, and still throws', async () => {
    const named = setup(() =>
      json(426, { error: 'upgrade_required', minSupportedAppVersion: '1.3.0' }),
    );
    const unnamed = setup(() =>
      json(426, { error: 'upgrade_required', minSupportedAppVersion: 3 }),
    );
    const page = setup(() => new Response('<html>Upgrade</html>', { status: 426 }));
    const signingIn = setup(
      () => json(426, { error: 'upgrade_required', minSupportedAppVersion: '1.3.0' }),
      null,
    );
    for (const t of [named, unnamed, page]) {
      expect((await failure(t.api.me())).code).toBe('upgrade_required');
    }
    expect((await failure(signingIn.api.login({ email: 'a@b.c', password: 'pw' }))).code).toBe(
      'upgrade_required',
    );
    expect([named.upgrades, unnamed.upgrades, page.upgrades, signingIn.upgrades]).toEqual([
      ['1.3.0'],
      [''],
      [''],
      ['1.3.0'],
    ]);
  });

  it('turns a success that is not JSON into a server error', async () => {
    const e = await failure(setup(() => new Response('<html>Hotspot login</html>')).api.me());
    expect([e.code, e.status]).toEqual(['server_error', 200]);
  });

  it('lets a method that answers nothing ignore the body, whatever it is', async () => {
    for (const answer of [
      new Response(null, { status: 204 }),
      new Response('', { status: 200 }),
      new Response('<html>OK</html>', { status: 200 }),
    ]) {
      const t = setup(() => answer);
      expect(await t.api.closeAccount({ currentPassword: 'old' })).toBeUndefined();
    }
  });

  it('turns a failure while reading the answer, like one while sending, into a network error', async () => {
    const cut = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'));
          },
        }),
      );
    expect((await failure(setup(cut).api.me())).code).toBe('network');
    const aborted = () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    };
    expect((await failure(setup(aborted).api.me())).code).toBe('network');
  });
});

describe('sign-in and sign-out', () => {
  const credentials = { email: 'ada@example.com', password: 'pw' };

  it('login and loginTwoFactor send no bearer, answer the tokens, and store nothing', async () => {
    const stepped = setup(() => json(200, { requiresTwoFactor: true, challenge: 'c1' }), null);
    expect(await stepped.api.login(credentials)).toEqual({
      requiresTwoFactor: true,
      challenge: 'c1',
    });
    const t = setup(() => json(200, { requiresTwoFactor: false, ...pair(3) }), null);
    expect(await t.api.login(credentials)).toEqual({ requiresTwoFactor: false, ...pair(3) });
    // The second step answers just the pair, without requiresTwoFactor.
    expect(await t.api.loginTwoFactor({ challenge: 'c1', code: '123456' })).toEqual(pair(3));
    expect(t.calls.map(bearer)).toEqual([null, null]);
    // The session stores the pair it signs in with (AppSession.signIn), not this client.
    expect(t.tokens()).toBeNull();
  });

  it.each([
    [401, 'invalid_credentials'],
    [423, 'account_locked'],
  ])('throws a sign-in failure (%i %s) as it is', async (status, code) => {
    const t = setup(() => json(status, { error: code, message: 'Not this time.' }));
    const e = await failure(t.api.login(credentials));
    expect([e.code, e.status, e.message]).toEqual([code, status, 'Not this time.']);
    expect(t.calls).toHaveLength(1);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(1));
  });

  it('logs out without a request when nothing is stored', async () => {
    const t = setup(() => json(200, { ok: true }), null);
    await t.api.logout();
    expect(t.calls).toEqual([]);
    expect(t.tokens()).toBeNull();
  });

  it.each(['session_revoked', 'unauthorized'])(
    'logs out with the bearer and never refreshes or reports a sign-out, even on %s',
    async (code) => {
      const t = setup(() => json(401, { error: code }));
      await t.api.logout();
      expect(t.calls.map(path)).toEqual(['/auth/logout']);
      expect(bearer(t.calls[0]!)).toBe('Bearer a1');
      expect(t.signedOut).toEqual([]);
      expect(t.tokens()).toBeNull();
    },
  );

  it('logs out and clears the tokens when the connection is lost', async () => {
    const t = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await t.api.logout();
    expect(t.calls.map(path)).toEqual(['/auth/logout']);
    expect(t.tokens()).toBeNull();
  });

  it('logs out with the refresh token alone when only that survived a restart', async () => {
    const t = setup(() => json(200, { ok: true }), { ...pair(1), accessToken: '' });
    await t.api.logout();
    expect([bearer(t.calls[0]!), bodyOf(t.calls[0]!)]).toEqual([null, { refreshToken: 'r1' }]);
    expect(t.tokens()).toBeNull();
  });
});

describe('the refresh and its edges', () => {
  it('does not refresh a call that sent no bearer', async () => {
    const nobody = setup(
      () => json(401, { error: 'unauthorized', message: 'Sign in to continue.' }),
      null,
    );
    const e = await failure(nobody.api.me());
    expect([e.code, e.message, nobody.calls.length]).toEqual([
      'unauthorized',
      'Sign in to continue.',
      1,
    ]);
    const brand = setup(() => json(401, { error: 'unauthorized' }));
    await failure(brand.api.brand());
    expect(brand.calls.map(path)).toEqual(['/brand']);
    expect(brand.signedOut).toEqual([]);
  });

  it('throws a 401 that is neither unauthorized nor session_revoked as it is', async () => {
    const t = setup(() => new Response('<html>Hotspot login</html>', { status: 401 }));
    const e = await failure(t.api.me());
    expect([e.code, e.status, t.calls.length, t.signedOut]).toEqual(['request_failed', 401, 1, []]);
    expect(t.tokens()).toEqual(pair(1));
  });

  it.each(['unauthorized', 'session_revoked'])(
    'throws the original error, and tells no one, when the tokens are gone by the time it answers %s',
    async (code) => {
      const wait = gate();
      const t = setup(async () => {
        await wait.open;
        return json(401, { error: code, message: 'The platform said so.' });
      });
      const pending = failure(t.api.me());
      t.store(null);
      wait.release();
      const e = await pending;
      expect([e.code, e.message]).toEqual([code, 'The platform said so.']);
      expect(t.calls).toHaveLength(1);
      expect(t.signedOut).toEqual([]);
    },
  );

  it('retries a POST with the same body and the new bearer', async () => {
    const t = setup((c) =>
      isRefresh(c)
        ? json(200, pair(2))
        : bearer(c) === 'Bearer a1'
          ? json(401, { error: 'unauthorized' })
          : json(200, { ok: true }),
    );
    await t.api.setPin({ currentPassword: 'old', pin: '1234' });
    expect(t.calls.map(path)).toEqual(['/me/pin', '/auth/refresh', '/me/pin']);
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', null, 'Bearer a2']);
    expect(bodyOf(t.calls[2]!)).toEqual(bodyOf(t.calls[0]!));
  });

  it('retries once, and throws what the retry answers', async () => {
    const t = setup((c) =>
      isRefresh(c) ? json(200, pair(2)) : json(401, { error: 'unauthorized' }),
    );
    expect((await failure(t.api.me())).code).toBe('unauthorized');
    expect(t.calls.map(path)).toEqual(['/me', '/auth/refresh', '/me']);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()?.accessToken).toBe('a2');
  });

  it('signs out when the retry finds the session revoked', async () => {
    const t = setup((c) =>
      isRefresh(c)
        ? json(200, pair(2))
        : bearer(c) === 'Bearer a1'
          ? json(401, { error: 'unauthorized' })
          : json(401, { error: 'session_revoked' }),
    );
    expect((await failure(t.api.me())).code).toBe('session_revoked');
    expect(t.signedOut).toEqual(['session_revoked']);
    expect(t.tokens()).toBeNull();
  });

  it('does not end a session that another request has refreshed again since the retry went out', async () => {
    const first = gate();
    const second = gate();
    const t = setup(async (c) => {
      await (bearer(c) === 'Bearer a1' ? first : second).open;
      return json(401, { error: 'session_revoked' });
    });
    const call = failure(t.api.me());
    t.store(pair(2));
    first.release(); // a1 is revoked, the store holds a2: the call retries with a2
    await later();
    t.store(pair(3)); // and while a2 is out, another request refreshes again
    second.release();
    expect((await call).code).toBe('session_revoked');
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', 'Bearer a2']);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(3));
  });

  it('retries with the stored token instead of refreshing when it is newer than the expired one', async () => {
    const wait = gate();
    const t = setup(async (c) => {
      if (bearer(c) !== 'Bearer a1') return json(200, { id: 'u1' });
      await wait.open;
      return json(401, { error: 'unauthorized' });
    });
    const first = t.api.me();
    t.store(pair(2));
    wait.release();
    expect((await first).id).toBe('u1');
    expect(t.calls.map(path)).toEqual(['/me', '/me']);
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', 'Bearer a2']);
  });

  it('waits for a refresh already under way before it judges a session_revoked', async () => {
    // The refresh has been applied by the platform, which replaced the session of a1, but its
    // answer has not been stored yet when the call made with a1 hears session_revoked.
    const wait = gate();
    const t = setup(async (c) => {
      if (isRefresh(c)) {
        await wait.open;
        return json(200, pair(2));
      }
      return bearer(c) === 'Bearer a1'
        ? json(401, { error: 'session_revoked' })
        : json(200, { id: 'u1' });
    });
    const refreshing = t.api.refresh();
    const call = t.api.me();
    // The 401 reaches the call while the refresh is still held, and the call has not judged yet.
    await later();
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(1));
    wait.release();
    expect([(await call).id, await refreshing]).toEqual(['u1', pair(2)]);
    expect(t.calls.map(bearer)).toEqual([null, 'Bearer a1', 'Bearer a2']);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(2));
  });

  it('gives every call that meets a failing refresh that failure, from one refresh request', async () => {
    const started = gate();
    const failing = gate();
    const t = setup(async (c) => {
      if (isRefresh(c)) {
        started.release();
        await failing.open;
        return json(503, { error: 'server_error' });
      }
      // The second call hears its 401 only once the refresh is under way.
      if (path(c) === '/dashboard') await started.open;
      return json(401, { error: 'unauthorized' });
    });
    const first = failure(t.api.me());
    const second = failure(t.api.dashboard());
    await later();
    failing.release();
    expect((await Promise.all([first, second])).map((e) => e.code)).toEqual([
      'server_error',
      'server_error',
    ]);
    expect(t.calls.filter(isRefresh)).toHaveLength(1);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(1));
  });

  it('shares the refresh with refresh(), and starts a new one once that has finished', async () => {
    let n = 1;
    const t = setup(() => json(200, pair(++n)));
    const [x, y] = await Promise.all([t.api.refresh(), t.api.refresh()]);
    expect([x, y]).toEqual([pair(2), pair(2)]);
    expect(t.calls).toHaveLength(1);
    expect(t.tokens()).toEqual(pair(2));
    await t.api.refresh();
    expect(t.calls.map(bodyOf)).toEqual([{ refreshToken: 'r1' }, { refreshToken: 'r2' }]);
    expect(t.tokens()).toEqual(pair(3));
  });

  it('rejects refresh() with unauthorized, and sends nothing, when no tokens are stored', async () => {
    const t = setup(() => json(200, pair(2)), null);
    expect((await failure(t.api.refresh())).code).toBe('unauthorized');
    expect(t.calls).toEqual([]);
    expect(t.signedOut).toEqual([]);
  });

  it.each([[{ ...pair(2), accessToken: 7 }], [{ tokenType: 'Bearer' }], ['tokens'], [null]])(
    'treats a refresh answer that is not a token pair (%j) as a server error and keeps the session',
    async (answer) => {
      const t = setup((c) =>
        isRefresh(c) ? json(200, answer) : json(401, { error: 'unauthorized' }),
      );
      const e = await failure(t.api.me());
      expect([e.code, e.status]).toEqual(['server_error', 200]);
      expect(t.calls.map(path)).toEqual(['/me', '/auth/refresh']);
      expect(t.signedOut).toEqual([]);
      expect(t.tokens()).toEqual(pair(1));
    },
  );

  const lasting: [string, () => Response, string][] = [
    [
      'a 426',
      () => json(426, { error: 'upgrade_required', minSupportedAppVersion: '1.3.0' }),
      'upgrade_required',
    ],
    ['a 429', () => json(429, { error: 'rate_limited' }, { 'Retry-After': '5' }), 'rate_limited'],
    [
      'a lost connection',
      () => {
        throw new TypeError('Failed to fetch');
      },
      'network',
    ],
  ];
  it.each(lasting)('keeps the session when the refresh meets %s', async (_name, answer, code) => {
    const t = setup((c) => (isRefresh(c) ? answer() : json(401, { error: 'unauthorized' })));
    expect((await failure(t.api.me())).code).toBe(code);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(pair(1));
  });

  it('signs out when the refresh is refused with any other 4xx', async () => {
    const t = setup((c) =>
      isRefresh(c) ? json(403, { error: 'forbidden' }) : json(401, { error: 'unauthorized' }),
    );
    expect((await failure(t.api.me())).code).toBe('forbidden');
    expect(t.signedOut).toEqual(['refresh_failed']);
    expect(t.tokens()).toBeNull();
  });

  it('refreshes first when only the refresh token survived, once for concurrent calls', async () => {
    const t = setup((c) => (isRefresh(c) ? json(200, pair(2)) : json(200, { id: 'u1' })), {
      ...pair(1),
      accessToken: '',
    });
    await Promise.all([t.api.me(), t.api.dashboard()]);
    expect(t.calls.map(path).sort()).toEqual(['/auth/refresh', '/dashboard', '/me']);
    expect(bearer(t.calls.find(isRefresh)!)).toBeNull();
    expect(t.calls.filter((c) => !isRefresh(c)).map(bearer)).toEqual(['Bearer a2', 'Bearer a2']);
  });
});
