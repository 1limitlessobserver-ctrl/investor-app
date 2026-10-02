// What the plan's twelve cases (createLiveApi.spec.ts) leave open: every method's request and
// answer as the platform sends them, the answers and errors as the client takes them, sign-in and
// sign-out, the refresh rules and their races, a failing token store or callback, and timeouts.
// All of it runs through a fake fetchImpl and a fake store; nothing inside the client is mocked.
// How an envelope or an answer is read on its own is liveEnvelope.spec.ts's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveApi,
  type AppIdentity,
  type LiveApi,
  type LiveApiConfig,
  type StoredSession,
} from './createLiveApi';
import { ROUTES, type ApiMethod } from './liveRoutes';
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
/** What the store holds: pair n of the sign-in named `key` (a refresh keeps the key). */
const session = (n: number, key = 'k1'): StoredSession & MobileTokens => ({
  sessionKey: key,
  ...pair(n),
});
/** What the store answers after a restart: the refresh token alone, under its sign-in's key. */
const restarted = (n: number, key = 'k1'): StoredSession => ({
  sessionKey: key,
  refreshToken: `r${n}`,
  accessToken: null,
});

/** Makes the fake store fail: each returns the error to reject with, or undefined to work. */
type Faults = {
  get?: () => Error | undefined;
  rotate?: (tokens: MobileTokens) => Error | undefined;
  clear?: () => Error | undefined;
};

function setup(
  script: Script,
  initial: StoredSession | null = session(1),
  options: {
    baseUrl?: string;
    app?: AppIdentity;
    faults?: Faults;
    /**
     * What another tab writes into the store just before the client's first rotate or clear
     * lands: the race that the store's own compare of the session's key closes.
     */
    cutIn?: StoredSession | null;
    /** Holds the store's nth read (counting from 1) until `until` settles, as a slow store would. */
    slowRead?: { n: number; until: Promise<void> };
    /** Replaces what setup passes, such as a callback. */
    config?: Partial<LiveApiConfig>;
  } = {},
) {
  const calls: Call[] = [];
  let tokens = initial;
  let reads = 0;
  let cutIn = options.cutIn;
  const landCutIn = () => {
    if (cutIn !== undefined) tokens = cutIn;
    cutIn = undefined;
  };
  /** Every write the client asked for (a rotation's pair, null for a clear), failed ones too. */
  const writes: (MobileTokens | null)[] = [];
  const signedOut: string[] = [];
  const upgrades: string[] = [];
  const storageErrors: unknown[] = [];
  const api = createLiveApi({
    baseUrl: options.baseUrl ?? BASE,
    tokenStore: {
      get: () => {
        reads += 1;
        const fault = options.faults?.get?.();
        if (fault !== undefined) return Promise.reject(fault);
        const slow = options.slowRead;
        return slow?.n === reads ? slow.until.then(() => tokens) : Promise.resolve(tokens);
      },
      // Each write compares the key it names with the stored one, as one step, as the real
      // store does inside its transaction.
      rotate: (t, key) => {
        writes.push(t);
        landCutIn();
        const fault = options.faults?.rotate?.(t);
        if (fault !== undefined) return Promise.reject(fault);
        if (tokens?.sessionKey !== key) return Promise.resolve(false);
        tokens = { sessionKey: key, ...t };
        return Promise.resolve(true);
      },
      clear: (key) => {
        writes.push(null);
        landCutIn();
        const fault = options.faults?.clear?.();
        if (fault !== undefined) return Promise.reject(fault);
        if (tokens === null || (key !== undefined && tokens.sessionKey !== key)) {
          return Promise.resolve(false);
        }
        tokens = null;
        return Promise.resolve(true);
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
    /** Changes the store behind the api's back, as another tab, a sign-in or a sign-out would. */
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
/** A promise that settles on `release()`: a fake platform awaits one to hold its answer back. */
function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}
/**
 * Lets every promise chain that no gate holds run as far as it can, without a timer: a call that
 * has heard its answer then waits where the client makes it wait.
 */
async function settle() {
  for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
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
    const t = setup(() => json(200, {}), session(1), { app });
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
        tokenStore: {
          get: () => Promise.resolve(null),
          rotate: () => Promise.resolve(false),
          clear: () => Promise.resolve(false),
        },
        app: APP,
        ...change,
      });
    expect(build).toThrow(TypeError);
    expect(build).toThrow(field);
  });

  it('reads its config once: changing it afterwards changes nothing that is sent', async () => {
    const app = { ...APP };
    const t = setup(() => json(200, {}), session(1), { app });
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
    const t = setup(() => json(200, { ok: true }), session(1), { app: { ...APP, deviceName } });
    await t.api.me();
    await t.api.logout();
    expect(t.calls.map(path)).toEqual(['/me', '/auth/logout']);
    expect(t.calls.map((c) => header(c, 'X-Device-Name'))).toEqual([sent, sent]);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const t = setup(() => json(200, {}), session(1), { baseUrl: `${BASE}/` });
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
      tokenStore: {
        get: () => Promise.resolve(null),
        rotate: () => Promise.resolve(false),
        clear: () => Promise.resolve(false),
      },
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
    expect(t.tokens()).toEqual(session(2));
    vi.stubEnv('MODE', 'production');
    const built: LiveApi = setup(() => json(200, {})).api;
    expect(built).not.toHaveProperty('_test_setTokens');
  });

  it('keeps the key of the stored session when _test_setTokens puts a pair in it', async () => {
    const t = setup(() => json(200, {}), session(1, 'k7'));
    await t.api._test_setTokens?.(pair(2));
    // A rotation, as a refresh stores its pair: the same sign-in with new tokens.
    expect([t.tokens(), t.writes]).toEqual([session(2, 'k7'), [pair(2)]]);
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
    // The session layer stores the pair it signs in with, not this client.
    expect(t.tokens()).toBeNull();
  });

  // The session layer stores what sign-in answers, so each step checks its answer with its guard
  // (liveEnvelope.spec.ts holds the guards' cases): one answer that is no session, for each.
  it.each([
    ['login', { requiresTwoFactor: false }],
    ['loginTwoFactor', {}],
  ] as const)(
    'turns a %s answer that is no session into a server error',
    async (method, answer) => {
      const t = setup(() => json(200, answer), null);
      const ask =
        method === 'login'
          ? t.api.login(credentials)
          : t.api.loginTwoFactor({ challenge: 'c1', code: '123456' });
      const e = await failure(ask);
      expect([e.code, e.status]).toEqual(['server_error', 200]);
    },
  );

  it.each([
    [401, 'invalid_credentials'],
    [423, 'account_locked'],
  ])('throws a sign-in failure (%i %s) as it is', async (status, code) => {
    const t = setup(() => json(status, { error: code, message: 'Not this time.' }));
    const e = await failure(t.api.login(credentials));
    expect([e.code, e.status, e.message]).toEqual([code, status, 'Not this time.']);
    expect(t.calls).toHaveLength(1);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(session(1));
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

  it('clears whatever the store holds, even a sign-in that lands as it logs out', async () => {
    // logout() names no session to clear: this device signs out, whoever signed in last.
    const t = setup(() => json(200, { ok: true }), session(1), { cutIn: session(5, 'k2') });
    await t.api.logout();
    expect([t.tokens(), t.writes]).toEqual([null, [null]]);
    // The platform hears of the session the logout read.
    expect([bearer(t.calls[0]!), bodyOf(t.calls[0]!)]).toEqual([
      'Bearer a1',
      { refreshToken: 'r1' },
    ]);
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
    ['cleared', { clear: () => closed }, closed, ['/auth/logout']],
  ])(
    'still clears and tells what it can, then rejects storage_error, when the store cannot be %s',
    async (_what, faults: Faults, cause, sent) => {
      const t = setup(() => json(200, { ok: true }), session(1), { faults });
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
    expect(t.tokens()).toEqual(session(1));
  });

  it.each(['unauthorized', 'session_revoked'])(
    'throws a 403 %s as it is: only a 401 is about the token',
    async (code) => {
      const t = setup(() => json(403, { error: code }));
      expect((await failure(t.api.me())).code).toBe(code);
      expect(t.calls).toHaveLength(1);
      expect(t.signedOut).toEqual([]);
      expect(t.tokens()).toEqual(session(1));
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

  // The last row keeps the retry's tokens under another key, as no real sign-in would: endSession
  // tells the store's session apart by its key, not by the token values alone.
  it.each([
    ['another request refreshed again', session(3)],
    ['another tab rotated the refresh token', { ...session(2), refreshToken: 'r9' }],
    ['the store holds a sign-in that only its key tells apart', session(2, 'k2')],
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
    t.store(session(2));
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
    t.store(session(2));
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
    expect(t.tokens()).toEqual(session(1));
    wait.release();
    expect([(await call).id, await refreshing]).toEqual(['u1', pair(2)]);
    expect(t.calls.map(bearer)).toEqual([null, 'Bearer a1', 'Bearer a2']);
    expect(t.signedOut).toEqual([]);
    expect(t.tokens()).toEqual(session(2));
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
    expect(t.tokens()).toEqual(session(1));
  });

  it('shares the refresh with refresh(), and starts a new one once that has finished', async () => {
    let n = 1;
    // The pair is answered and stored without whatever else the platform's answer carries.
    const t = setup(() => json(200, { ...pair(++n), requiresTwoFactor: false }));
    const [x, y] = await Promise.all([t.api.refresh(), t.api.refresh()]);
    expect([x, y]).toEqual([pair(2), pair(2)]);
    expect(t.calls).toHaveLength(1);
    expect(t.tokens()).toEqual(session(2));
    await t.api.refresh();
    expect(t.calls.map(bodyOf)).toEqual([{ refreshToken: 'r1' }, { refreshToken: 'r2' }]);
    expect(t.tokens()).toEqual(session(3));
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
    ['an expiry that is not a string', { ...pair(2), refreshExpiresAt: 2592000 }],
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
      expect(t.tokens()).toEqual(session(1));
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
        refused ? [['refresh_failed'], null] : [[], session(1)],
      );
    },
  );

  // The platform answers a refresh some time after it was asked, and the store can change in
  // between: the investor signs out, signs in again, or another tab refreshes (the refresh token
  // is shared, the access token is not). The answer then belongs to a session that is over, so it
  // must change nothing of what the store holds now. In the last row only the key differs, which
  // no real sign-in does (its tokens are new too): the store's session is told apart by its key.
  // refresh() itself answers the pair only while the store holds the sign-in it renewed.
  const changes: [string, StoredSession | null, 'the pair' | 'unauthorized'][] = [
    ['a logout', null, 'unauthorized'],
    ['a new sign-in', session(5, 'k2'), 'unauthorized'],
    ["another tab's refresh", { ...session(1), refreshToken: 'r9' }, 'the pair'],
    ['a sign-in that only its key tells apart', session(1, 'k2'), 'unauthorized'],
  ];
  describe.each(changes)('a refresh answered after %s', (_name, now, answered) => {
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

    it(`stores nothing, and refresh() answers ${answered}`, async () => {
      const { t, outcome } = await overlap(() => json(200, pair(2)));
      expect(outcome).toEqual(
        answered === 'the pair'
          ? { tokens: pair(2) }
          : { error: expect.objectContaining({ code: 'unauthorized', status: 401 }) as unknown },
      );
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

  it('rotates under the key it read, which the store turns away once another sign-in is in', async () => {
    // Another tab signs in after the client's own check and before its rotate() lands: only the
    // store's compare can see it. Nothing failed to report, and refresh() answers no pair of a
    // sign-in the store no longer holds.
    const t = setup(() => json(200, pair(2)), session(1), { cutIn: session(5, 'k2') });
    const e = await failure(t.api.refresh());
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    expect([t.tokens(), t.writes]).toEqual([session(5, 'k2'), [pair(2)]]);
    expect([t.storageErrors, t.signedOut]).toEqual([[], []]);
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
    expect([refreshes, t.signedOut, t.tokens()]).toEqual([2, [], session(2)]);
  });
});

// A request belongs to the session it went out with, named by its sign-in's key. That session is
// over once the client has ended one since (logout(), a revocation, a refused refresh) or the store
// holds another sign-in (another key: someone signed in, here or in another tab), and stale when
// another call or tab has stored newer tokens of it. Only a session that is neither over nor stale
// is refreshed, retried or ended, and only with tokens of that same sign-in.
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
      t.store(session(5, 'k2')); // someone signs in: the session layer starts a new session
      held.release();
      expect((await invest).code).toBe(code);
      // The investment and the logout, both as a1: nothing goes out as the new session.
      expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
        '/invest Bearer a1',
        '/auth/logout Bearer a1',
      ]);
      expect([t.signedOut, t.tokens()]).toEqual([[], session(5, 'k2')]);
    },
  );

  it.each(['unauthorized', 'session_revoked'])(
    'refreshes with the refresh token another tab rotated, and retries, on %s',
    async (code) => {
      // Tabs share the refresh token, not the access token: another tab's refresh of the same
      // sign-in (k1) leaves this tab's a1 stale, and the platform may say so with either code.
      const held = gate();
      const t = setup(async (c) => {
        if (isRefresh(c)) return json(200, pair(10));
        if (bearer(c) !== 'Bearer a1') return json(200, { id: 'u1' });
        await held.open;
        return json(401, { error: code });
      });
      const call = t.api.me();
      t.store({ ...session(1), refreshToken: 'r9' });
      held.release();
      expect((await call).id).toBe('u1');
      expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
        '/me Bearer a1',
        '/auth/refresh null',
        '/me Bearer a10',
      ]);
      expect(bodyOf(t.calls[1]!)).toEqual({ refreshToken: 'r9' });
      expect([t.signedOut, t.tokens()]).toEqual([[], session(10)]);
    },
  );

  // Another tab signed out and signed in as another investor (k2): the store now answers that
  // investor's refresh token with no access token (as StoredSession asks) or, from a store that
  // does not keep to that, beside this tab's old one. A call this tab sent as k1 must not be
  // refreshed with it, retried, or end anything.
  describe.each([
    [
      "beside this tab's old access token",
      { sessionKey: 'k2', refreshToken: 'r5', accessToken: 'a1' },
    ],
    ['with no access token', restarted(5, 'k2')],
  ])('when another tab signs in as someone else, %s', (_how, other: StoredSession) => {
    it.each(['unauthorized', 'session_revoked'])(
      'throws %s untouched, refreshes nothing and tells no one',
      async (code) => {
        const held = gate();
        const t = setup(async (c) => {
          if (isRefresh(c)) return json(200, pair(6));
          if (bearer(c) !== 'Bearer a1') return json(200, { kind: 'wallet' });
          await held.open;
          return json(401, { error: code, message: 'The platform said so.' });
        });
        const invest = failure(t.api.invest({ planId: 'p1', amountCents: 500000 }));
        t.store(other);
        held.release();
        const e = await invest;
        expect([e.code, e.status, e.message]).toEqual([code, 401, 'The platform said so.']);
        expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual(['/invest Bearer a1']);
        expect([t.signedOut, t.writes, t.tokens()]).toEqual([[], [], other]);
      },
    );
  });

  it.each(['joined', 'started'])(
    'throws the 401 untouched when another tab signs in as someone else while the refresh it %s is out',
    async (how) => {
      const started = gate();
      const answer = gate();
      const t = setup(async (c) => {
        if (!isRefresh(c)) {
          return bearer(c) === 'Bearer a1'
            ? json(401, { error: 'unauthorized' })
            : json(200, { id: 'u1' });
        }
        started.release();
        await answer.open;
        return json(200, pair(2));
      });
      const refreshing = how === 'joined' ? failure(t.api.refresh()) : undefined;
      const call = failure(t.api.me());
      await started.open;
      await settle(); // the call has heard its 401 and waits for the refresh
      t.store(session(5, 'k2'));
      answer.release();
      expect((await call).code).toBe('unauthorized');
      // refresh() itself answers no pair of a sign-in the store no longer holds.
      expect((await refreshing)?.code).toBe(how === 'joined' ? 'unauthorized' : undefined);
      // No retry: the store no longer holds the sign-in the call went out with.
      expect(t.calls.map(path).sort()).toEqual(['/auth/refresh', '/me']);
      expect([t.signedOut, t.writes, t.tokens()]).toEqual([[], [], session(5, 'k2')]);
    },
  );

  it.each(['unauthorized', 'session_revoked'])(
    'throws %s untouched, not retried, when the refresh it joins renewed an earlier sign-in',
    async (code) => {
      // A refresh of k1 is out when the investor signs out and someone signs in (k2) on this tab:
      // a call of the new session that hears a 401 joins it, and must not go out with k1's pair.
      const started = gate();
      const answer = gate();
      const t = setup(async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (isRefresh(c)) {
          started.release();
          await answer.open;
          return json(200, pair(2));
        }
        return bearer(c) === 'Bearer a5' ? json(401, { error: code }) : json(200, { id: 'u1' });
      });
      const refreshing = failure(t.api.refresh());
      await started.open;
      await t.api.logout();
      t.store(session(5, 'k2')); // the session layer starts the new sign-in
      const call = failure(t.api.me());
      await settle(); // the call has heard its 401 and joined the refresh still out
      answer.release();
      expect((await call).code).toBe(code);
      expect((await refreshing).code).toBe('unauthorized');
      expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
        '/auth/refresh null',
        '/auth/logout Bearer a1',
        '/me Bearer a5',
      ]);
      expect([t.signedOut, t.tokens()]).toEqual([[], session(5, 'k2')]);
    },
  );

  it('sends nothing for a call with no access token when the refresh it joins renewed another sign-in', async () => {
    // This tab's refresh of k1 is out when another tab signs in as someone else (k2): a call that
    // has no access token for k2 refreshes first by joining it, and must not go out as k1.
    const started = gate();
    const answer = gate();
    const t = setup(async (c) => {
      if (!isRefresh(c)) return json(200, { id: 'u1' });
      started.release();
      await answer.open;
      return json(200, pair(2));
    });
    const refreshing = failure(t.api.refresh());
    await started.open;
    t.store(restarted(5, 'k2'));
    const call = failure(t.api.me());
    await settle(); // the call has joined the refresh still out
    answer.release();
    const e = await call;
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    expect((await refreshing).code).toBe('unauthorized');
    expect(t.calls.map(path)).toEqual(['/auth/refresh']);
    expect([t.signedOut, t.writes, t.tokens()]).toEqual([[], [], restarted(5, 'k2')]);
  });

  it('sends nothing for a call that refreshed first when the investor signed out meanwhile', async () => {
    const started = gate();
    const answer = gate();
    const t = setup(async (c) => {
      if (path(c) === '/auth/logout') return json(200, { ok: true });
      if (!isRefresh(c)) return json(200, { id: 'u1' });
      started.release();
      await answer.open;
      return json(200, pair(2));
    }, restarted(1));
    const call = failure(t.api.me());
    await started.open;
    await t.api.logout();
    answer.release();
    const e = await call;
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    // The logout names the session by its refresh token; the call never goes out.
    expect(t.calls.map((c) => `${path(c)} ${bearer(c)}`)).toEqual([
      '/auth/refresh null',
      '/auth/logout null',
    ]);
    expect([t.signedOut, t.tokens()]).toEqual([[], null]);
  });

  it('sends nothing for a call that refreshed first when another tab signed in meanwhile', async () => {
    // The refresh renewed k1, the sign-in the call read, but by the time its pair is in, the store
    // holds k2: the call's session is over, so it does not go out as k1.
    const started = gate();
    const answer = gate();
    const t = setup(async (c) => {
      if (!isRefresh(c)) return json(200, { id: 'u1' });
      started.release();
      await answer.open;
      return json(200, pair(2));
    }, restarted(1));
    const call = failure(t.api.me());
    await started.open;
    t.store(session(5, 'k2'));
    answer.release();
    const e = await call;
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    expect(t.calls.map(path)).toEqual(['/auth/refresh']);
    expect([t.signedOut, t.writes, t.tokens()]).toEqual([[], [], session(5, 'k2')]);
  });

  it('sends nothing for a call that refreshed first when a logout that could not clear came meanwhile', async () => {
    // The store still holds the sign-in the call read, so only the client's count says no.
    const started = gate();
    const answer = gate();
    const t = setup(
      async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (!isRefresh(c)) return json(200, { id: 'u1' });
        started.release();
        await answer.open;
        return json(200, pair(2));
      },
      restarted(1),
      { faults: { clear: () => new DOMException('The database is closed', 'InvalidStateError') } },
    );
    const call = failure(t.api.me());
    await started.open;
    expect((await failure(t.api.logout())).code).toBe('storage_error');
    answer.release();
    const e = await call;
    expect([e.code, e.status]).toEqual(['unauthorized', 401]);
    expect(t.calls.map(path)).toEqual(['/auth/refresh', '/auth/logout']);
    expect([t.signedOut, t.tokens()]).toEqual([[], restarted(1)]);
  });

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
      const refreshing = how === 'joined' ? failure(t.api.refresh()) : undefined;
      const call = failure(t.api.me());
      await started.open;
      await t.api.logout();
      answer.release();
      expect((await call).code).toBe('unauthorized');
      expect((await refreshing)?.code).toBe(how === 'joined' ? 'unauthorized' : undefined);
      // No retry: the pair belongs to a session the investor has ended.
      expect(t.calls.map(path).sort()).toEqual(['/auth/logout', '/auth/refresh', '/me']);
      expect([t.signedOut, t.tokens()]).toEqual([[], null]);
    },
  );

  it('throws the 401 untouched when its refresh lands after a logout that could not clear', async () => {
    // The store still holds the sign-in the call went out with, so only the client's own count of
    // the sessions it has ended tells that this call's session is over.
    const started = gate();
    const answer = gate();
    const t = setup(
      async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (!isRefresh(c)) return json(401, { error: 'unauthorized', message: 'Expired.' });
        started.release();
        await answer.open;
        return json(200, pair(2));
      },
      session(1),
      { faults: { clear: () => new DOMException('The database is closed', 'InvalidStateError') } },
    );
    const call = failure(t.api.me());
    await started.open;
    expect((await failure(t.api.logout())).code).toBe('storage_error');
    answer.release();
    const e = await call;
    expect([e.code, e.message]).toEqual(['unauthorized', 'Expired.']);
    expect(t.calls.map(path).sort()).toEqual(['/auth/logout', '/auth/refresh', '/me']);
    expect(t.signedOut).toEqual([]);
  });

  it('refreshes nothing for an unauthorized heard after a logout that could not clear', async () => {
    // The store still holds the session the call went out with: only the client's count says no.
    const held = gate();
    const t = setup(
      async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (isRefresh(c)) return json(200, pair(2));
        await held.open;
        return json(401, { error: 'unauthorized', message: 'Expired.' });
      },
      session(1),
      { faults: { clear: () => new DOMException('The database is closed', 'InvalidStateError') } },
    );
    const call = failure(t.api.me());
    expect((await failure(t.api.logout())).code).toBe('storage_error');
    held.release();
    const e = await call;
    expect([e.code, e.message]).toEqual(['unauthorized', 'Expired.']);
    expect(t.calls.map(path)).toEqual(['/me', '/auth/logout']);
    expect([t.signedOut, t.tokens()]).toEqual([[], session(1)]);
  });

  // A logout that could not clear leaves the session in the store, so only the client's count tells
  // a refresh that was out that its session is over: it stores nothing back and ends nothing, and
  // its callers still get what the platform answered.
  it.each([
    ['a pair', () => json(200, pair(2)), { tokens: pair(2) }],
    [
      'a refusal',
      () => json(401, { error: 'session_revoked' }),
      { error: expect.objectContaining({ code: 'session_revoked' }) as unknown },
    ],
  ])(
    'rotates nothing back in, and signs no one out, when %s lands after a logout that could not clear',
    async (_what, answer, outcome) => {
      const started = gate();
      const landed = gate();
      const t = setup(
        async (c) => {
          if (path(c) === '/auth/logout') return json(200, { ok: true });
          started.release();
          await landed.open;
          return answer();
        },
        session(1),
        {
          faults: { clear: () => new DOMException('The database is closed', 'InvalidStateError') },
        },
      );
      const refreshing = t.api.refresh().then(
        (tokens) => ({ tokens }),
        (error: unknown) => ({ error }),
      );
      await started.open;
      expect((await failure(t.api.logout())).code).toBe('storage_error');
      landed.release();
      expect(await refreshing).toEqual(outcome);
      expect([t.writes, t.signedOut, t.tokens()]).toEqual([[null], [], session(1)]);
    },
  );

  it('ends the session before it reads the store, so a refresh landing meanwhile is not retried with', async () => {
    // The fourth read is logout()'s, held as a slow store would; the call's refresh lands during it.
    const started = gate();
    const landed = gate();
    const slow = gate();
    const t = setup(
      async (c) => {
        if (path(c) === '/auth/logout') return json(200, { ok: true });
        if (!isRefresh(c)) return json(401, { error: 'unauthorized' });
        started.release();
        await landed.open;
        return json(200, pair(2));
      },
      session(1),
      { slowRead: { n: 4, until: slow.open } },
    );
    const call = failure(t.api.me());
    await started.open;
    const out = t.api.logout();
    landed.release();
    await settle();
    slow.release();
    await out;
    expect((await call).code).toBe('unauthorized');
    expect(t.calls.map(path)).toEqual(['/me', '/auth/refresh', '/auth/logout']);
    expect([t.writes, t.signedOut, t.tokens()]).toEqual([[null], [], null]);
  });

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
    const t = setup(() => json(200, { id: 'u1' }), session(1), {
      faults: { get: () => unreadable },
    });
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
      const t = setup(() => json(401, { error: code }), session(1), {
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
      const t = setup(script, session(1), { faults: { clear: () => closed } });
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
      session(1),
      { faults: { rotate: () => full } },
    );
    expect((await t.api.me()).id).toBe('u1');
    expect(t.calls.map(bearer)).toEqual(['Bearer a1', null, 'Bearer a2']);
    expect([t.storageErrors, t.tokens()]).toEqual([[full], session(1)]);
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
    const revoked = setup(() => json(401, { error: 'session_revoked' }), session(1), {
      config: { onSignedOut: thrower },
    });
    expect((await failure(revoked.api.me())).code).toBe('session_revoked');
    expect(revoked.tokens()).toBeNull();
    const outdated = setup(() => json(426, { error: 'upgrade_required' }), session(1), {
      config: { onUpgradeRequired: thrower },
    });
    expect((await failure(outdated.api.me())).code).toBe('upgrade_required');
    const unsaved = setup(
      (c) => (isRefresh(c) ? json(200, pair(2)) : json(200, {})),
      restarted(1),
      {
        faults: { rotate: () => full },
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
      expect([t.calls.length, t.signedOut, t.tokens()]).toEqual([1, [], session(1)]);
    },
  );

  it('reads its own abort as a timeout, whatever error the fetch rejects with', async () => {
    fakeClock();
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    const t = setup(
      ({ init }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(aborted));
        }),
    );
    const call = watch(t.api.me());
    await vi.advanceTimersByTimeAsync(20_000);
    expect([call.error?.code, call.error?.cause]).toEqual(['timeout', aborted]);
  });

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
    expect([t.signedOut, t.tokens()]).toEqual([[], session(2)]);
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
    expect([t.calls.length, t.signedOut, t.tokens()]).toEqual([1, [], session(1)]);
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
      const t = setup(script, session(1), {
        config: { onSignedOut: (why) => heard.push([why, t.tokens()]) },
      });
      await failure(t.api.me());
      expect(heard).toEqual([[reason, null]]);
    },
  );

  // Another tab signs out, or signs in as someone else, between the client's check of the store
  // and its clear(): the store's compare finds the session over already, so the clear is no
  // write, no one is told, and the platform's error is thrown as it came.
  const ended = { error: 'session_revoked', message: 'This session has ended.' };
  it.each([
    ['a revoked session', 'a sign-in', session(5, 'k2')],
    ['a revoked session', 'a sign-out', null],
    ['a refused refresh', 'a sign-in', session(5, 'k2')],
    ['a refused refresh', 'a sign-out', null],
  ] as const)(
    'hears nothing of %s when %s in another tab reached the store first',
    async (way, _other, other) => {
      const t = setup(
        (c) =>
          way === 'a revoked session' || isRefresh(c)
            ? json(401, ended)
            : json(401, { error: 'unauthorized' }),
        session(1),
        { cutIn: other },
      );
      const e = await failure(t.api.me());
      expect([e.code, e.message]).toEqual(['session_revoked', ended.message]);
      expect([t.signedOut, t.writes, t.tokens()]).toEqual([[], [null], other]);
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
