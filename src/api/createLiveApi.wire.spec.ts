// What the plan's twelve cases (createLiveApi.spec.ts) leave open: every method's request as the
// platform reads it, the error envelope read defensively, sign-in and sign-out, and the edges of
// the refresh rules. All of it runs through a fake fetchImpl; nothing inside the client is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveApi,
  PUBLIC_ROUTES,
  ROUTES,
  type ApiMethod,
  type AppIdentity,
  type LiveApi,
  type LiveApiConfig,
  type StoredSession,
} from './createLiveApi';
import { MobileApiError } from './MobileApiError';
import type { PlatformApi } from './PlatformApi';
import type { KycSubmission, LegacyPlan, MobileTokens } from './types';

const BASE = 'https://platform.test/api/mobile/v1';
const RUNAWAY = 20;
const APP: AppIdentity = {
  version: '1.2.0',
  platform: 'web',
  deviceId: 'device-0001',
  deviceName: 'Ada’s laptop',
};

type Call = { url: string; init: RequestInit };
type Script = (call: Call) => Response | Promise<Response>;

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
/** What the store answers after a restart: the refresh token alone. */
const restarted = (n: number): StoredSession => ({ refreshToken: `r${n}`, accessToken: null });

/** Makes the fake store fail: each returns the error to reject with, or undefined to work. */
type Faults = {
  get?: () => Error | undefined;
  set?: (tokens: MobileTokens | null) => Error | undefined;
};

function setup(
  script: Script,
  initial: StoredSession | null = pair(1),
  options: {
    baseUrl?: string;
    app?: AppIdentity;
    faults?: Faults;
    /** Replaces what setup passes, such as a callback. */
    config?: Partial<LiveApiConfig>;
  } = {},
) {
  const calls: Call[] = [];
  let tokens = initial;
  /** Every write the client asked for (a pair, or null to clear), in order, failed ones too. */
  const writes: (MobileTokens | null)[] = [];
  const signedOut: string[] = [];
  const upgrades: string[] = [];
  const storageErrors: unknown[] = [];
  const api = createLiveApi({
    baseUrl: options.baseUrl ?? BASE,
    tokenStore: {
      get: () => {
        const fault = options.faults?.get?.();
        return fault === undefined ? Promise.resolve(tokens) : Promise.reject(fault);
      },
      set: (t) => {
        writes.push(t);
        const fault = options.faults?.set?.(t);
        if (fault !== undefined) return Promise.reject(fault);
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
    onStorageError: (error) => storageErrors.push(error),
    ...options.config,
  });
  return {
    api,
    calls,
    writes,
    signedOut,
    upgrades,
    storageErrors,
    tokens: () => tokens,
    /** Changes the store behind the api's back, as another request or a sign-out would. */
    store: (t: StoredSession | null) => {
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
  vi.restoreAllMocks();
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
    const app: AppIdentity = { ...APP, deviceName: name };
    const t = setup(() => json(200, {}), pair(1), { app });
    await t.api.me();
    expect(header(t.calls[0]!, 'X-Device-Name')).toBeNull();
    expect(header(t.calls[0]!, 'X-Device-Id')).toBe('device-0001');
  });

  it.each([
    ['baseUrl', 'a relative path', { baseUrl: '/api/mobile/v1' }],
    ['baseUrl', 'an unset origin', { baseUrl: 'undefined/api/mobile/v1' }],
    ['baseUrl', 'another scheme', { baseUrl: 'ftp://platform.test/api/mobile/v1' }],
    ['app.deviceId', 'too short', { app: { ...APP, deviceId: 'device1' } }],
    ['app.deviceId', 'spelled with an en dash', { app: { ...APP, deviceId: 'device–0001' } }],
    ['app.deviceId', 'ended by a newline', { app: { ...APP, deviceId: 'device-0001\n' } }],
    ['app.version', 'empty', { app: { ...APP, version: '' } }],
  ])('refuses at once a config whose %s is %s', (field, _what, change) => {
    const build = () =>
      createLiveApi({
        baseUrl: BASE,
        tokenStore: { get: () => Promise.resolve(null), set: () => Promise.resolve() },
        app: APP,
        ...change,
      });
    expect(build).toThrow(TypeError);
    expect(build).toThrow(field);
  });

  it('reads its config once: changing it afterwards changes nothing that is sent', async () => {
    const app = { ...APP };
    const t = setup(() => json(200, {}), pair(1), { app });
    Object.assign(app, { deviceId: 'another-device', deviceName: 'Another' });
    await t.api.me();
    expect([header(t.calls[0]!, 'X-Device-Id'), header(t.calls[0]!, 'X-Device-Name')]).toEqual([
      'device-0001',
      'Ada%E2%80%99s%20laptop',
    ]);
  });

  it.each([
    ['a character beyond the BMP', 'Ada’s 📱', 'Ada%E2%80%99s%20%F0%9F%93%B1'],
    ['a lone surrogate, as U+FFFD', 'Ada\uD83D', 'Ada%EF%BF%BD'],
    ['a lone trailing surrogate, as U+FFFD', '\uDC00Ada', '%EF%BF%BDAda'],
  ])('sends the device name with %s, and every call goes out', async (_what, deviceName, sent) => {
    const t = setup(() => json(200, { ok: true }), pair(1), { app: { ...APP, deviceName } });
    await t.api.me();
    await t.api.logout();
    expect(t.calls.map(path)).toEqual(['/me', '/auth/logout']);
    expect(t.calls.map((c) => header(c, 'X-Device-Name'))).toEqual([sent, sent]);
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

  it('offers _test_setTokens, which writes to the store, in test mode only', async () => {
    const t = setup(() => json(200, {}));
    await t.api._test_setTokens?.(pair(2));
    expect(t.tokens()).toEqual(pair(2));
    vi.stubEnv('MODE', 'production');
    const built: LiveApi = setup(() => json(200, {})).api;
    expect(built).not.toHaveProperty('_test_setTokens');
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
  // One answer that suits every method: the statement as CSV, and for the rest one JSON body with
  // a token pair (sign-in, refresh), `ok: true` (the void methods) and a list for sessions().
  const body = { ...pair(9), requiresTwoFactor: false, ok: true, current: false, sessions: [] };
  const csv = 'date,description\n';
  const anything: Script = (c) =>
    path(c).startsWith('/statements/file?')
      ? new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
      : json(200, body);
  // What a method resolves from that answer where it is not the body as it is: nothing for the
  // methods whose answer the interface drops, the list, the bare pair, the CSV.
  const shaped: Partial<Record<ApiMethod, unknown>> = {
    sessions: [],
    refresh: pair(9),
    loginTwoFactor: pair(9),
    statementCsv: csv,
    logout: undefined,
    changePassword: undefined,
    setPin: undefined,
    disableTwoFactor: undefined,
    closeAccount: undefined,
    pushSubscribe: undefined,
    pushUnsubscribe: undefined,
    replyTicket: undefined,
    maturityChoice: undefined,
    removeBeneficiary: undefined,
  };

  it.each(everyMethod)(
    '%s sends one request, to its route, as the platform reads it, and resolves what it should',
    async (name) => {
      const t = setup(anything);
      const row = wire[name];
      const answer = await row.run(t.api);
      expect(answer).toEqual(Object.hasOwn(shaped, name) ? shaped[name] : body);
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
      // The platform never redirects, and following one would turn a POST into a GET.
      expect([
        header(call, 'Accept'),
        call.init.credentials,
        call.init.cache,
        call.init.redirect,
      ]).toEqual([
        name === 'statementCsv' ? 'text/csv, text/plain' : 'application/json',
        'omit',
        'no-store',
        'error',
      ]);
      expect(ROUTES[name]).toEqual({ method: verb, path: target.split('?')[0] });
    },
  );

  it('names the same public routes as the client', () => {
    expect([...PUBLIC_ROUTES].sort()).toEqual([...publicRoutes].sort());
  });

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

  it('encodes a query value so that the platform reads it back as it was', async () => {
    const t = setup(() => json(200, {}));
    for (const id of ['a b+c#d é', '']) await t.api.investment(id);
    await t.api.notifications(0);
    expect(t.calls.map(path)).toEqual([
      '/investments/detail?id=a+b%2Bc%23d+%C3%A9',
      '/investments/detail?id=',
      '/notifications?limit=0',
    ]);
    expect(new URL(t.calls[0]!.url).searchParams.get('id')).toBe('a b+c#d é');
  });
});

describe('the error envelope', () => {
  it('treats a body that is not a JSON object as an empty envelope', async () => {
    const page = (status: number) => () => new Response('<html>Bad gateway</html>', { status });
    const gateway = await failure(setup(page(502)).api.me());
    expect([gateway.code, gateway.status, gateway.message]).toEqual([
      'server_error',
      502,
      new MobileApiError('server_error', 502).message,
    ]);
    const missing = await failure(setup(page(404)).api.me());
    expect([missing.code, missing.status]).toEqual(['request_failed', 404]);
    // A host's own 429 page still means slow down.
    const busy = setup(
      () =>
        new Response('<html>Slow down</html>', { status: 429, headers: { 'Retry-After': '9' } }),
    );
    const limited = await failure(busy.api.me());
    expect([limited.code, limited.retryAfterSeconds]).toEqual(['rate_limited', 9]);
    const empty = await failure(setup(() => new Response(null, { status: 500 })).api.me());
    expect([empty.code, empty.status]).toEqual(['server_error', 500]);
    // JSON that is not an object has no envelope to read either.
    for (const raw of ['null', '[]', '"oops"', '42']) {
      const e = await failure(setup(() => new Response(raw, { status: 503 })).api.me());
      expect([e.code, e.status]).toEqual(['server_error', 503]);
    }
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
    // An empty code is no code either.
    const nameless = await failure(setup(() => json(500, { error: '' })).api.me());
    expect(nameless.code).toBe('server_error');
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

  // The platform keys a ticket's fields `body` and `ticketId`; the interface, the sample and the
  // forms call them `message` and `id`, so a screen maps `fields` onto the form fields it owns.
  it("names openTicket's field errors as the interface does, and no other call's", async () => {
    const refused = () =>
      json(400, { error: 'invalid_input', fields: { subject: 'Too long.', body: 'Say more.' } });
    const opened = await failure(setup(refused).api.openTicket({ subject: 'Hello', message: '' }));
    expect(opened.fields).toEqual({ subject: 'Too long.', message: 'Say more.' });
    const other = await failure(
      setup(refused).api.manualDeposit({ methodId: 'm1', amountCents: 1 }),
    );
    expect(other.fields).toEqual({ subject: 'Too long.', body: 'Say more.' });
  });

  it("names replyTicket's field errors as the interface does", async () => {
    const t = setup(() =>
      json(400, {
        error: 'invalid_input',
        fields: { ticketId: 'Required', body: 'Say more.', extra: 'As it is.' },
      }),
    );
    const e = await failure(t.api.replyTicket({ id: '', message: '' }));
    expect(e.fields).toEqual({ id: 'Required', message: 'Say more.', extra: 'As it is.' });
  });

  it('takes Retry-After from the body, else from the header as seconds or as a date', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00.400Z'));
    const wait = async (body: object, headers: Record<string, string> = {}) =>
      (await failure(setup(() => json(429, body, headers)).api.me())).retryAfterSeconds;
    const limited = { error: 'rate_limited' };
    expect(await wait({ ...limited, retryAfterSeconds: 12 }, { 'Retry-After': '30' })).toBe(12);
    expect(await wait({ ...limited, retryAfterSeconds: 'soon' }, { 'Retry-After': '7' })).toBe(7);
    // The body's value is read as the header's: whole seconds rounded up, never below 0.
    expect(await wait({ ...limited, retryAfterSeconds: -5 }, { 'Retry-After': '30' })).toBe(30);
    expect(await wait({ ...limited, retryAfterSeconds: 1.5 }, { 'Retry-After': '30' })).toBe(2);
    expect(await wait(limited, { 'Retry-After': '45' })).toBe(45);
    // A date counts the whole seconds until then, rounded up so a retry is never early, and not
    // below 0 once it has passed.
    expect(await wait(limited, { 'Retry-After': 'Thu, 01 Oct 2026 12:01:30 GMT' })).toBe(90);
    expect(await wait(limited, { 'Retry-After': 'Thu, 01 Oct 2026 11:59:00 GMT' })).toBe(0);
    // 309 digits overflow to Infinity, which is no wait either.
    for (const unusable of ['soon', '-5', '1.5', '', 'Thu, soon', '9'.repeat(309)]) {
      expect(await wait(limited, { 'Retry-After': unusable })).toBeNull();
    }
    expect(await wait(limited)).toBeNull();
    // A Retry-After on another answer, such as a 503, is read as well.
    const busy = setup(() => json(503, { error: 'server_error' }, { 'Retry-After': '120' }));
    expect((await failure(busy.api.me())).retryAfterSeconds).toBe(120);
    // JSON can spell a number too big to be finite (1e999); that is no wait either.
    const huge = '{"error":"rate_limited","retryAfterSeconds":1e999}';
    const overflow = setup(
      () => new Response(huge, { status: 429, headers: { 'Retry-After': '7' } }),
    );
    expect((await failure(overflow.api.me())).retryAfterSeconds).toBe(7);
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

  // Every JSON answer of the platform is an object (it wraps what would be a list), so anything
  // else is not its answer, and must not reach a method that unwraps it as a raw TypeError.
  it.each(['null', '[]', '"oops"', '42'])(
    'turns a success that is JSON but not an object (%s) into a server error',
    async (raw) => {
      const t = setup(() => new Response(raw));
      const asks = [
        (a: PlatformApi) => a.sessions(),
        (a: PlatformApi) => a.loginTwoFactor({ challenge: 'c1', code: '123456' }),
        (a: PlatformApi) => a.me(),
      ];
      for (const ask of asks) {
        const e = await failure(ask(t.api));
        expect([e.code, e.status]).toEqual(['server_error', 200]);
      }
    },
  );

  // Every route that answers nothing the interface keeps answers `{ ok: true, ...}`; anything else
  // did not come from the route, so the action may not have happened.
  it('turns an answer to a void method that is not { ok: true } into a server error', async () => {
    const closing = (answer: () => Response) =>
      setup(answer).api.closeAccount({ currentPassword: 'old' });
    expect(await closing(() => json(200, { ok: true, sessionsRevoked: 2 }))).toBeUndefined();
    for (const answer of [
      () => new Response(null, { status: 204 }),
      () => new Response('', { status: 200 }),
      () => new Response('<html>OK</html>', { status: 200 }),
      () => json(200, {}),
      () => json(200, { ok: false }),
      () => json(200, { ok: 'true' }),
      () => json(200, null),
    ]) {
      const e = await failure(closing(answer));
      expect([e.code, e.status]).toEqual(['server_error', answer().status]);
    }
  });

  it('takes the statement only as CSV or plain text', async () => {
    const statement = (type: string) =>
      setup(() => new Response('a,b\n', { headers: { 'Content-Type': type } })).api.statementCsv(
        '2026-09',
      );
    for (const type of ['text/csv; charset=utf-8', 'TEXT/PLAIN', 'text/csv ; charset=utf-8']) {
      expect(await statement(type)).toBe('a,b\n');
    }
    for (const type of ['text/html', 'application/json', 'text/csvx', '']) {
      const e = await failure(statement(type));
      expect([e.code, e.status], type).toEqual(['server_error', 200]);
    }
  });

  it('turns a sessions answer without its list into a server error', async () => {
    for (const body of [{ ok: true }, { sessions: 's1' }]) {
      const e = await failure(setup(() => json(200, body)).api.sessions());
      expect([e.code, e.status]).toEqual(['server_error', 200]);
    }
  });

  it('reports a request that never got an answer as offline, and a lost answer by its status', async () => {
    for (const dropped of [
      new TypeError('Failed to fetch'),
      new DOMException('The operation was aborted.', 'AbortError'),
    ]) {
      const e = await failure(setup(() => Promise.reject(dropped)).api.me());
      expect([e.code, e.status, e.cause]).toEqual(['network', 0, dropped]);
    }
    const cut = new TypeError('terminated');
    const lost = (status: number) => () =>
      new Response(new ReadableStream({ start: (controller) => controller.error(cut) }), {
        status,
      });
    // A 2xx means the platform acted (the transfer went through): the answer is lost, not the
    // connection, so it must not read as offline and invite the investor to send it again.
    const sent = await failure(
      setup(lost(200)).api.sendTransfer({ recipient: '$bob', amountCents: 300, pin: '1234' }),
    );
    expect([sent.code, sent.status, sent.cause]).toEqual(['server_error', 200, cut]);
    for (const [status, code] of [
      [503, 'server_error'],
      [404, 'request_failed'],
    ] as const) {
      const e = await failure(setup(lost(status)).api.me());
      expect([e.code, e.status]).toEqual([code, status]);
    }
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

  // The session layer stores what sign-in answers, so it must be a session to store.
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
  ] as const)('turns a %s answer with %s into a server error', async (method, _what, answer) => {
    const t = setup(() => json(200, answer), null);
    const ask =
      method === 'login'
        ? t.api.login(credentials)
        : t.api.loginTwoFactor({ challenge: 'c1', code: '123456' });
    const e = await failure(ask);
    expect([e.code, e.status]).toEqual(['server_error', 200]);
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
    const t = setup(() => json(200, { ok: true }), restarted(1));
    await t.api.logout();
    expect([bearer(t.calls[0]!), bodyOf(t.calls[0]!)]).toEqual([null, { refreshToken: 'r1' }]);
    expect(t.tokens()).toBeNull();
  });

  it('clears the store before it tells the platform, which may never answer', async () => {
    const reached = gate();
    const t = setup(() => {
      reached.release();
      return new Promise<Response>(() => undefined);
    });
    void t.api.logout();
    await reached.open;
    expect([t.tokens(), t.writes, t.calls.map(path)]).toEqual([null, [null], ['/auth/logout']]);
  });

  it.each(['session_revoked', 'unauthorized'])(
    'neither refreshes nor reports a sign-out for a call that hears %s during a logout',
    async (code) => {
      const callOut = gate();
      const logoutOut = gate();
      const answerCall = gate();
      const t = setup(async (c) => {
        if (path(c) === '/auth/logout') {
          logoutOut.release();
          return json(200, { ok: true });
        }
        if (isRefresh(c)) return json(200, pair(2));
        callOut.release();
        await answerCall.open;
        return json(401, { error: code });
      });
      const call = failure(t.api.me());
      await callOut.open;
      const out = t.api.logout();
      await logoutOut.open;
      answerCall.release();
      expect((await call).code).toBe(code);
      await out;
      expect(t.calls.map(path)).toEqual(['/me', '/auth/logout']);
      expect([t.signedOut, t.tokens()]).toEqual([[], null]);
    },
  );

  const unreadable = new DOMException('Decryption failed', 'OperationError');
  const closed = new DOMException('The database is closed', 'InvalidStateError');
  it.each([
    ['read', { get: () => unreadable }, unreadable, []],
    ['cleared', { set: () => closed }, closed, ['/auth/logout']],
  ])(
    'still clears and tells what it can, then rejects storage_error, when the store cannot be %s',
    async (_what, faults: Faults, cause, sent) => {
      const t = setup(() => json(200, { ok: true }), pair(1), { faults });
      const e = await failure(t.api.logout());
      expect([e.code, e.status, e.cause]).toEqual(['storage_error', 0, cause]);
      // The clear is asked for either way; the platform is told whenever the tokens were read.
      expect([t.writes, t.calls.map(path)]).toEqual([[null], sent]);
    },
  );
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
    'throws a 403 %s as it is: only a 401 is about the token',
    async (code) => {
      const t = setup(() => json(403, { error: code }));
      expect((await failure(t.api.me())).code).toBe(code);
      expect(t.calls).toHaveLength(1);
      expect(t.signedOut).toEqual([]);
      expect(t.tokens()).toEqual(pair(1));
    },
  );

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

  it.each([
    ['another request refreshed again', pair(3)],
    ['another tab rotated the refresh token', { ...pair(2), refreshToken: 'r9' }],
  ])('does not end the session when %s while the retry was out', async (_how, moved) => {
    const first = gate();
    const retried = gate();
    const second = gate();
    const t = setup(async (c) => {
      if (bearer(c) === 'Bearer a1') {
        await first.open;
      } else {
        retried.release();
        await second.open;
      }
      return json(401, { error: 'session_revoked' });
    });
    const call = failure(t.api.me());
    t.store(pair(2));
    first.release(); // a1 is revoked, the store holds a2: the call retries with a2
    await retried.open;
    t.store(moved);
    second.release();
    expect((await call).code).toBe('session_revoked');
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', 'Bearer a2']);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(moved);
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

  it('refreshes, rather than retry, when the store holds a refresh token alone', async () => {
    // By the time the 401 lands the store holds a refresh token alone (no access token): there is
    // no token to send, so the call refreshes with it and retries with the pair it gets.
    const wait = gate();
    const t = setup(async (c) => {
      if (isRefresh(c)) return json(200, pair(3));
      if (bearer(c) !== 'Bearer a1') return json(200, { id: 'u1' });
      await wait.open;
      return json(401, { error: 'unauthorized' });
    });
    const first = t.api.me();
    t.store(restarted(2));
    wait.release();
    expect((await first).id).toBe('u1');
    expect(t.calls.map(path)).toEqual(['/me', '/auth/refresh', '/me']);
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', null, 'Bearer a3']);
    expect(bodyOf(t.calls[1]!)).toEqual({ refreshToken: 'r2' });
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
    // The pair is answered and stored without whatever else the platform's answer carries.
    const t = setup(() => json(200, { ...pair(++n), requiresTwoFactor: false }));
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
    const e = await failure(t.api.refresh());
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    expect(t.calls).toEqual([]);
    expect(t.signedOut).toEqual([]);
  });

  // Not a token pair: a session cannot be stored from it.
  it.each([
    ['a number for a token', { ...pair(2), accessToken: 7 }],
    ['no tokens', { tokenType: 'Bearer' }],
    ['a string', 'tokens'],
    ['null', null],
    ['an empty access token', { ...pair(2), accessToken: '' }],
    ['an empty refresh token', { ...pair(2), refreshToken: '' }],
    ['another token type', { ...pair(2), tokenType: 'bearer' }],
  ])(
    'treats a refresh answer with %s as a server error and keeps the session',
    async (_what, answer) => {
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

  // A refusal is the platform's own word about the refresh token: a 4xx that names an error, but
  // 426 (update first) and 429 (slow down). A host's or proxy's page names none, and keeps it.
  const page = (status: number) => () => new Response('<html>Not here</html>', { status });
  it.each([
    ['401 session_revoked', () => json(401, { error: 'session_revoked' }), 'session_revoked', true],
    ['403 forbidden', () => json(403, { error: 'forbidden' }), 'forbidden', true],
    ['400 invalid_input', () => json(400, { error: 'invalid_input' }), 'invalid_input', true],
    ['403 page', page(403), 'request_failed', false],
    ['404 page', page(404), 'request_failed', false],
    ['408 page', page(408), 'request_failed', false],
    ['421 page', page(421), 'request_failed', false],
    ['426', () => json(426, { error: 'upgrade_required' }), 'upgrade_required', false],
    ['429', () => json(429, { error: 'rate_limited' }), 'rate_limited', false],
    ['500', () => json(500, { error: 'server_error' }), 'server_error', false],
    ['503 page', page(503), 'server_error', false],
    ['a lost connection', () => Promise.reject(new TypeError('Failed to fetch')), 'network', false],
  ] as const)(
    'throws a refresh answered %s as it is, and signs out only on a refusal',
    async (_answer, answer: Script, code, refused) => {
      const t = setup((c) => (isRefresh(c) ? answer(c) : json(401, { error: 'unauthorized' })));
      expect((await failure(t.api.me())).code).toBe(code);
      expect([t.signedOut, t.tokens()]).toEqual(
        refused ? [['refresh_failed'], null] : [[], pair(1)],
      );
    },
  );

  // The platform answers a refresh some time after it was asked, and the store can change in
  // between: the investor signs out, signs in again, or another tab refreshes (the refresh token
  // is shared, the access token is not). The answer then belongs to a session that is over, so it
  // must change nothing of what the store holds now.
  const changes: [string, MobileTokens | null][] = [
    ['a logout', null],
    ['a new sign-in', pair(5)],
    ["another tab's refresh", { ...pair(1), refreshToken: 'r9' }],
  ];
  describe.each(changes)('a refresh answered after %s', (_name, now) => {
    /** Asks for a refresh, makes the change while it is out, then lets the platform answer it. */
    async function overlap(answer: () => Response) {
      const started = gate();
      const landed = gate();
      const t = setup(async (c) => {
        if (!isRefresh(c)) return json(200, { ok: true }); // the logout request
        started.release();
        await landed.open;
        return answer();
      });
      const refreshing = t.api.refresh().then(
        (tokens) => ({ tokens }),
        (error: unknown) => ({ error }),
      );
      await started.open;
      if (now === null) await t.api.logout();
      else t.store(now);
      landed.release();
      return { t, outcome: await refreshing };
    }

    it('stores nothing, and still gives its callers the pair', async () => {
      const { t, outcome } = await overlap(() => json(200, pair(2)));
      expect(outcome).toEqual({ tokens: pair(2) });
      expect(t.tokens()).toEqual(now);
      expect(t.signedOut).toEqual([]);
    });

    it('signs nothing out, and still throws the refusal', async () => {
      const { t, outcome } = await overlap(() => json(401, { error: 'session_revoked' }));
      expect(outcome).toMatchObject({ error: { code: 'session_revoked', status: 401 } });
      expect(t.tokens()).toEqual(now);
      expect(t.signedOut).toEqual([]);
    });
  });

  it('refreshes first when only the refresh token survived, once for concurrent calls', async () => {
    const t = setup(
      (c) => (isRefresh(c) ? json(200, pair(2)) : json(200, { id: 'u1' })),
      restarted(1),
    );
    await Promise.all([t.api.me(), t.api.dashboard()]);
    expect(t.calls.map(path).sort()).toEqual(['/auth/refresh', '/dashboard', '/me']);
    expect(bearer(t.calls.find(isRefresh)!)).toBeNull();
    expect(t.calls.filter((c) => !isRefresh(c)).map(bearer)).toEqual(['Bearer a2', 'Bearer a2']);
  });

  it.each([
    ['refused', () => json(401, { error: 'session_revoked' }), 'session_revoked', true],
    ['lost', () => Promise.reject(new TypeError('Failed to fetch')), 'network', false],
    ['answered 503', () => json(503, { error: 'server_error' }), 'server_error', false],
    ['answered 429', () => json(429, { error: 'rate_limited' }), 'rate_limited', false],
  ] as const)(
    'sends nothing but the first refresh after a restart when it is %s',
    async (_how, answer: Script, code, refused) => {
      const t = setup((c) => (isRefresh(c) ? answer(c) : json(200, {})), restarted(1));
      expect((await failure(t.api.me())).code).toBe(code);
      expect(t.calls.map(path)).toEqual(['/auth/refresh']);
      expect([t.signedOut, t.tokens()]).toEqual(
        refused ? [['refresh_failed'], null] : [[], restarted(1)],
      );
    },
  );

  it('refreshes again for the next call after a refresh that failed', async () => {
    let refreshes = 0;
    const t = setup((c) => {
      if (isRefresh(c)) {
        return ++refreshes === 1 ? Promise.reject(new TypeError('Failed')) : json(200, pair(2));
      }
      return bearer(c) === 'Bearer a1'
        ? json(401, { error: 'unauthorized' })
        : json(200, { id: 'u1' });
    });
    expect((await failure(t.api.me())).code).toBe('network');
    expect((await t.api.me()).id).toBe('u1');
    expect([refreshes, t.signedOut, t.tokens()]).toEqual([2, [], pair(2)]);
  });
});

// A request belongs to the session it went out with. That session is over once the client has
// ended one since (logout(), a revocation, a refused refresh); it has moved on when another call
// or tab stored newer tokens. Only a session that is neither is refreshed, retried or ended.
describe('the session a request belongs to', () => {
  it.each(['unauthorized', 'session_revoked'])(
    'throws %s untouched when the investor signed out meanwhile, even with a new sign-in stored',
    async (code) => {
      const held = gate();
      const t = setup(async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (bearer(c) !== 'Bearer a1') return json(200, { kind: 'wallet' });
        await held.open;
        return json(401, { error: code });
      });
      const invest = failure(t.api.invest({ planId: 'p1', amountCents: 500000 }));
      await t.api.logout();
      t.store(pair(5)); // someone signs in: the session layer stores the new pair
      held.release();
      expect((await invest).code).toBe(code);
      // The investment and the logout, both as a1: nothing goes out as the new session.
      expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
        '/invest Bearer a1',
        '/auth/logout Bearer a1',
      ]);
      expect([t.signedOut, t.tokens()]).toEqual([[], pair(5)]);
    },
  );

  it.each(['unauthorized', 'session_revoked'])(
    'refreshes with the refresh token another tab rotated, and retries, on %s',
    async (code) => {
      // Tabs share the refresh token, not the access token: another tab's refresh leaves this
      // tab's a1 stale, and the platform may say so with either code.
      const held = gate();
      const t = setup(async (c) => {
        if (isRefresh(c)) return json(200, pair(10));
        if (bearer(c) !== 'Bearer a1') return json(200, { id: 'u1' });
        await held.open;
        return json(401, { error: code });
      });
      const call = t.api.me();
      t.store({ ...pair(1), refreshToken: 'r9' });
      held.release();
      expect((await call).id).toBe('u1');
      expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
        '/me Bearer a1',
        '/auth/refresh null',
        '/me Bearer a10',
      ]);
      expect(bodyOf(t.calls[1]!)).toEqual({ refreshToken: 'r9' });
      expect([t.signedOut, t.tokens()]).toEqual([[], pair(10)]);
    },
  );

  it.each(['joined', 'started'])(
    'throws the 401 untouched when the refresh it %s lands after a logout',
    async (how) => {
      const started = gate();
      const answer = gate();
      const t = setup(async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (!isRefresh(c)) return json(401, { error: 'unauthorized' });
        started.release();
        await answer.open;
        return json(200, pair(2));
      });
      const refreshing = how === 'joined' ? t.api.refresh() : undefined;
      const call = failure(t.api.me());
      await started.open;
      await t.api.logout();
      answer.release();
      expect((await call).code).toBe('unauthorized');
      await refreshing;
      // No retry: the pair belongs to a session the investor has ended.
      expect(t.calls.map(path).sort()).toEqual(['/auth/logout', '/auth/refresh', '/me']);
      expect([t.signedOut, t.tokens()]).toEqual([[], null]);
    },
  );

  it('ends a revoked session once for every call that hears it at the same time', async () => {
    const t = setup(() => json(401, { error: 'session_revoked' }));
    const heard = await Promise.all([t.api.me(), t.api.dashboard(), t.api.kyc()].map(failure));
    expect(heard.map((e) => e.code)).toEqual([
      'session_revoked',
      'session_revoked',
      'session_revoked',
    ]);
    expect([t.signedOut, t.writes]).toEqual([['session_revoked'], [null]]);
  });
});

// The platform's verdict is what the caller gets: a token store that fails and a callback that
// throws are reported beside it, never instead of it.
describe('when the token store or a callback fails', () => {
  const unreadable = new DOMException('Decryption failed', 'OperationError');
  const closed = new DOMException('The database is closed', 'InvalidStateError');
  const full = new DOMException('The quota has been exceeded', 'QuotaExceededError');

  it('rejects storage_error, and asks the platform nothing, when the store cannot be read', async () => {
    const t = setup(() => json(200, { id: 'u1' }), pair(1), { faults: { get: () => unreadable } });
    for (const ask of [() => t.api.me(), () => t.api.refresh()]) {
      const e = await failure(ask());
      expect([e.code, e.status, e.cause]).toEqual(['storage_error', 0, unreadable]);
    }
    expect(t.calls).toEqual([]);
  });

  it.each(['unauthorized', 'session_revoked'])(
    'keeps a %s as the answer, with the store failure as its cause, when the store fails after it',
    async (code) => {
      let reads = 0;
      const t = setup(() => json(401, { error: code }), pair(1), {
        faults: { get: () => (++reads > 1 ? unreadable : undefined) },
      });
      const e = await failure(t.api.me());
      expect([e.code, e.status, e.cause]).toEqual([code, 401, unreadable]);
      expect([t.calls.length, t.signedOut, t.writes]).toEqual([1, [], []]);
    },
  );

  it.each([
    ['a revoked session', () => json(401, { error: 'session_revoked' }), 'session_revoked'],
    [
      'a refused refresh',
      (c: Call) =>
        isRefresh(c)
          ? json(401, { error: 'session_revoked' })
          : json(401, { error: 'unauthorized' }),
      'refresh_failed',
    ],
  ])(
    "still signs out on %s when the store cannot be cleared, and throws the platform's error",
    async (_what, script: Script, reason) => {
      const t = setup(script, pair(1), { faults: { set: () => closed } });
      const e = await failure(t.api.me());
      expect([e.code, e.status, e.cause]).toEqual(['session_revoked', 401, closed]);
      expect([t.signedOut, t.writes]).toEqual([[reason], [null]]);
    },
  );

  it('still answers with a refreshed pair it cannot save, retries with it, and reports why', async () => {
    const t = setup(
      (c) =>
        isRefresh(c)
          ? json(200, pair(2))
          : bearer(c) === 'Bearer a1'
            ? json(401, { error: 'unauthorized' })
            : json(200, { id: 'u1' }),
      pair(1),
      { faults: { set: (tokens) => (tokens === null ? undefined : full) } },
    );
    expect((await t.api.me()).id).toBe('u1');
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', null, 'Bearer a2']);
    expect([t.storageErrors, t.tokens()]).toEqual([[full], pair(1)]);
  });

  it('reports a callback that throws on its own, and still answers the call', async () => {
    // Every microtask still runs (the test runner needs them); what one throws is kept here
    // instead of reaching the runner as an uncaught error.
    const reported: unknown[] = [];
    const queue = globalThis.queueMicrotask;
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      queue(() => {
        try {
          task();
        } catch (error) {
          reported.push(error);
        }
      });
    });
    const bug = new Error('a handler bug');
    const thrower = () => {
      throw bug;
    };
    const revoked = setup(() => json(401, { error: 'session_revoked' }), pair(1), {
      config: { onSignedOut: thrower },
    });
    expect((await failure(revoked.api.me())).code).toBe('session_revoked');
    expect(revoked.tokens()).toBeNull();
    const outdated = setup(() => json(426, { error: 'upgrade_required' }), pair(1), {
      config: { onUpgradeRequired: thrower },
    });
    expect((await failure(outdated.api.me())).code).toBe('upgrade_required');
    const unsaved = setup(
      (c) => (isRefresh(c) ? json(200, pair(2)) : json(200, {})),
      restarted(1),
      {
        faults: { set: () => full },
        config: { onStorageError: thrower },
      },
    );
    expect(await unsaved.api.me()).toEqual({});
    expect(reported).toEqual([bug, bug, bug]);
  });
});

describe('a platform that does not answer', () => {
  /**
   * Puts the client's timeouts on Vitest's fake clock. The global AbortSignal here is Node's, whose
   * timeout() runs on a timer the fake clock does not reach; jsdom's runs on the faked setTimeout.
   */
  function fakeClock() {
    vi.useFakeTimers();
    const dom = (globalThis as unknown as { jsdom: { window: { AbortSignal: unknown } } }).jsdom;
    vi.stubGlobal('AbortSignal', dom.window.AbortSignal);
  }
  /** Answers nothing until the request's signal gives up on it, as fetch does. */
  const silent: Script = ({ init }) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
    });
  /** Where a call stands: undefined while it waits, else what it ended in. */
  function watch(call: Promise<unknown>) {
    const state: { error?: MobileApiError } = {};
    void failure(call).then((e) => (state.error = e));
    return state;
  }

  it.each([
    [
      'a transfer',
      20_000,
      (a: PlatformApi) => a.sendTransfer({ recipient: '$bob', amountCents: 300, pin: '1234' }),
    ],
    [
      'an identity check, with its images,',
      90_000,
      (a: PlatformApi) => a.submitKyc({ legalName: 'Ada' } as KycSubmission),
    ],
  ])(
    'gives up on %s after %i ms, as a timeout: it may have gone through',
    async (_what, ms, ask) => {
      fakeClock();
      const t = setup(silent);
      const call = watch(ask(t.api));
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(call.error).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect([
        call.error?.code,
        call.error?.status,
        (call.error?.cause as Error | undefined)?.name,
      ]).toEqual(['timeout', 0, 'TimeoutError']);
      expect([t.calls.length, t.signedOut, t.tokens()]).toEqual([1, [], pair(1)]);
    },
  );

  it('gives a refresh 15 s, holds no call past that, and lets the next call refresh again', async () => {
    fakeClock();
    let refreshes = 0;
    const t = setup((c) => {
      if (isRefresh(c)) return ++refreshes === 1 ? silent(c) : json(200, pair(2));
      return bearer(c) === 'Bearer a1'
        ? json(401, { error: 'unauthorized' })
        : json(200, { id: 'u1' });
    });
    const first = watch(t.api.me());
    const joined = watch(t.api.dashboard());
    await vi.advanceTimersByTimeAsync(14_999);
    expect([first.error, joined.error]).toEqual([undefined, undefined]);
    await vi.advanceTimersByTimeAsync(1);
    expect([first.error?.code, joined.error?.code]).toEqual(['timeout', 'timeout']);
    expect((await t.api.me()).id).toBe('u1');
    expect(t.calls.filter(isRefresh)).toHaveLength(2);
    expect([t.signedOut, t.tokens()]).toEqual([[], pair(2)]);
  });
});

// The platform has no idempotency key: a money call sent twice can move money twice. Only a 401
// about the token, which the platform answers before its handler runs, is ever sent again.
describe.each([
  ['a lost connection', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['a 500', () => json(500, { error: 'server_error' })],
  ['a 503', () => json(503, { error: 'payments_not_configured' })],
  ['a 429', () => json(429, { error: 'rate_limited' }, { 'Retry-After': '1' })],
] as const)('a money call answered with %s', (_answer, answer: Script) => {
  it.each([
    [
      'sendTransfer',
      (a: PlatformApi) => a.sendTransfer({ recipient: '$bob', amountCents: 300, pin: '1234' }),
    ],
    ['invest', (a: PlatformApi) => a.invest({ planId: 'p1', amountCents: 10000 })],
    [
      'requestWithdrawal',
      (a: PlatformApi) => a.requestWithdrawal({ kind: 'cash', amountCents: 100 }),
    ],
    ['manualDeposit', (a: PlatformApi) => a.manualDeposit({ methodId: 'm1', amountCents: 1200 })],
    ['cardDeposit', (a: PlatformApi) => a.cardDeposit({ amountCents: 5000 })],
  ])('%s is sent once, and its failure thrown', async (_method, ask) => {
    const t = setup(answer);
    await failure(ask(t.api));
    expect([t.calls.length, t.signedOut, t.tokens()]).toEqual([1, [], pair(1)]);
  });
});

describe('onSignedOut', () => {
  it.each([
    ['a revoked session', () => json(401, { error: 'session_revoked' }), 'session_revoked'],
    [
      'a refused refresh',
      (c: Call) =>
        isRefresh(c)
          ? json(401, { error: 'session_revoked' })
          : json(401, { error: 'unauthorized' }),
      'refresh_failed',
    ],
  ] as const)(
    'hears of %s once the store is already clear',
    async (_what, script: Script, reason) => {
      const heard: [string, StoredSession | null][] = [];
      const t = setup(script, pair(1), {
        config: { onSignedOut: (why) => heard.push([why, t.tokens()]) },
      });
      await failure(t.api.me());
      expect(heard).toEqual([[reason, null]]);
    },
  );

  it('hears once of a refused refresh that several calls share', async () => {
    const t = setup((c) =>
      isRefresh(c) ? json(401, { error: 'session_revoked' }) : json(401, { error: 'unauthorized' }),
    );
    await Promise.all([t.api.me(), t.api.dashboard(), t.api.kyc()].map(failure));
    expect([t.calls.filter(isRefresh).length, t.signedOut, t.writes]).toEqual([
      1,
      ['refresh_failed'],
      [null],
    ]);
  });
});
