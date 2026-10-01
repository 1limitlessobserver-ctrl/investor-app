// The live PlatformApi: a company's platform over HTTPS, under /api/mobile/v1 (the platform's
// docs/MOBILE_API.md). This is the one file in the app that calls fetch.
//
// Every method but refresh and logout is one `request`:
//   - the app headers, `credentials: 'omit'` and `cache: 'no-store'` (no investor data outlives the
//     session), and `Authorization: Bearer <access token>` on every route but the public ones (brand,
//     login, loginTwoFactor, refresh);
//   - any failure is a MobileApiError, built from the error envelope `{ error, message?, fields?,
//     detail?, retryAfterSeconds? }` and the Retry-After header, each read only as far as it has the
//     right type, so a host's HTML error page counts as an empty envelope; a lost connection is
//     `MobileApiError.network()`; a 426 also tells onUpgradeRequired the oldest version served; the
//     two ticket calls key `fields` by the interface's names (`message`, `id`), not the platform's;
//     a 2xx answer that cannot be read as the JSON object it should be is a `server_error` too;
//   - 401 `unauthorized` (the access token expired) refreshes once, shared by every call that meets
//     it at the same time, and retries once with the token that is then stored;
//   - 401 `session_revoked` retries once with a newer token if another call has stored one since (the
//     platform replaces the session row at each refresh), and otherwise ends the session. A 401 on
//     the retry is the answer; only a `session_revoked` there still ends the session.
//
// A refresh the platform refuses with a 4xx ends the session too (`refresh_failed`); one that fails
// any other way (5xx, 429, 426, no connection) leaves it for the next try. A refresh answered after
// the investor has signed out or signed in again stores nothing and signs no one out. logout() is
// one plain request that refreshes and retries nothing. login and loginTwoFactor answer the tokens
// and store nothing: the session stores the pair it signs in with.
//
// The access token lives in memory only, so after a restart the store holds just the refresh token
// (an empty `accessToken`): the first signed-in call then refreshes before it sends anything.

import { MobileApiError } from './MobileApiError';
import type { PlatformApi } from './PlatformApi';
import type { MobileTokens, SessionView } from './types';

/**
 * Where the app keeps the signed-in session (src/session/tokens.ts). After a restart `get()` answers
 * the pair with an empty `accessToken`: the access token lives in memory only, and only the refresh
 * token was kept.
 */
export type TokenStore = {
  get(): Promise<MobileTokens | null>;
  set(tokens: MobileTokens | null): Promise<void>;
};

export type LiveApiConfig = {
  /** The platform's API root, such as "https://platform.example.com/api/mobile/v1". */
  baseUrl: string;
  tokenStore: TokenStore;
  app: { version: string; platform: 'web'; deviceId: string; deviceName?: string | undefined };
  /** Tests pass their own. The default calls the global fetch at the moment of each call. */
  fetchImpl?: typeof fetch | undefined;
  /**
   * The platform ended the session without the investor asking: it revoked the session, or it
   * refused the refresh. The tokens are already cleared. logout() never calls this.
   */
  onSignedOut?: ((reason: 'session_revoked' | 'refresh_failed') => void) | undefined;
  /**
   * An answer was 426: the platform no longer serves this app version. `minVersion` is the oldest
   * it serves, or '' when the answer did not say.
   */
  onUpgradeRequired?: ((minVersion: string) => void) | undefined;
};

/** The name of a PlatformApi method (`mode` is not one). */
type ApiMethod = Exclude<keyof PlatformApi, 'mode'>;
type Route = { readonly method: 'GET' | 'POST'; readonly path: string };

/**
 * The route of every PlatformApi method: its HTTP method and its path under `baseUrl`, without the
 * query string. These methods add a query key to the path: investment (id), statements (kind),
 * statement and statementCsv (period), notifications (limit), supportTickets (page), ticket (id).
 * Exported for the e2e route checks. `push/subscribe` and `push/unsubscribe` are not in the
 * platform's docs yet; they are added to the platform with web push.
 */
export const ROUTES: Readonly<Record<ApiMethod, Route>> = {
  login: { method: 'POST', path: '/auth/login' },
  loginTwoFactor: { method: 'POST', path: '/auth/login/2fa' },
  refresh: { method: 'POST', path: '/auth/refresh' },
  logout: { method: 'POST', path: '/auth/logout' },
  brand: { method: 'GET', path: '/brand' },

  me: { method: 'GET', path: '/me' },
  setNotificationPrefs: { method: 'POST', path: '/me/notification-prefs' },
  changePassword: { method: 'POST', path: '/me/password' },
  setPin: { method: 'POST', path: '/me/pin' },
  sessions: { method: 'GET', path: '/me/sessions' },
  revokeSession: { method: 'POST', path: '/me/sessions/revoke' },
  enrollTwoFactor: { method: 'POST', path: '/me/two-factor/enroll' },
  enableTwoFactor: { method: 'POST', path: '/me/two-factor/enable' },
  disableTwoFactor: { method: 'POST', path: '/me/two-factor/disable' },
  closeAccount: { method: 'POST', path: '/me/close' },

  dashboard: { method: 'GET', path: '/dashboard' },
  investments: { method: 'GET', path: '/investments' },
  investment: { method: 'GET', path: '/investments/detail' },
  strategies: { method: 'GET', path: '/strategies' },
  history: { method: 'GET', path: '/history' },
  statements: { method: 'GET', path: '/statements' },
  statement: { method: 'GET', path: '/statements/detail' },
  statementCsv: { method: 'GET', path: '/statements/file' },

  notifications: { method: 'GET', path: '/notifications' },
  markRead: { method: 'POST', path: '/notifications/read' },
  pushSubscribe: { method: 'POST', path: '/push/subscribe' },
  pushUnsubscribe: { method: 'POST', path: '/push/unsubscribe' },

  supportTickets: { method: 'GET', path: '/support/tickets' },
  openTicket: { method: 'POST', path: '/support/tickets' },
  ticket: { method: 'GET', path: '/support/ticket' },
  replyTicket: { method: 'POST', path: '/support/reply' },

  depositMethods: { method: 'GET', path: '/deposit/methods' },
  manualDeposit: { method: 'POST', path: '/deposit/manual' },
  cardDeposit: { method: 'POST', path: '/deposit/checkout' },
  withdrawals: { method: 'GET', path: '/withdrawals' },
  requestWithdrawal: { method: 'POST', path: '/withdrawals' },
  transfers: { method: 'GET', path: '/transfers' },
  sendTransfer: { method: 'POST', path: '/transfers' },
  invest: { method: 'POST', path: '/invest' },
  maturityChoice: { method: 'POST', path: '/maturity-choice' },

  kyc: { method: 'GET', path: '/kyc' },
  submitKyc: { method: 'POST', path: '/kyc' },

  legacyPlan: { method: 'GET', path: '/legacy-plan' },
  saveLegacyPlan: { method: 'POST', path: '/legacy-plan' },
  previewLegacyPlan: { method: 'POST', path: '/legacy-plan/preview' },
  beneficiaries: { method: 'GET', path: '/beneficiaries' },
  addBeneficiary: { method: 'POST', path: '/beneficiaries' },
  updateBeneficiary: { method: 'POST', path: '/beneficiaries/update' },
  removeBeneficiary: { method: 'POST', path: '/beneficiaries/remove' },

  oracleAsk: { method: 'POST', path: '/oracle/ask' },
};

type RequestOptions = {
  /** What a POST sends as JSON; `{}` when left out. */
  body?: unknown;
  /** Added to the path as a query string; a key whose value is undefined is left out. */
  query?: Readonly<Record<string, string | number | undefined>>;
  /** A signed-in route sends the bearer (the default); `false` is a public one (sign-in, brand). */
  auth?: boolean;
  /**
   * What a 2xx answer is: JSON (the default), text (the statement CSV), or nothing the interface
   * keeps (`{ ok: true }` and the like), which is read but not parsed.
   */
  as?: 'json' | 'text' | 'none';
  /**
   * A JSON answer that fails this is a server error. By default it must be an object, as every
   * answer of the platform is; the refresh answer must be a token pair.
   */
  check?: (answer: unknown) => boolean;
  /**
   * The interface's name for each field the platform names differently, by the platform's name: an
   * error's `fields` come back under the interface's names, so a screen can map them onto the form
   * fields it owns.
   */
  fieldNames?: ReadonlyMap<string, string>;
};

// The platform keys a ticket's fields `body` and `ticketId`; PlatformApi (and so the sample and the
// forms) call them `message` and `id`.
const OPEN_TICKET_FIELDS: ReadonlyMap<string, string> = new Map([['body', 'message']]);
const REPLY_TICKET_FIELDS: ReadonlyMap<string, string> = new Map([
  ['body', 'message'],
  ['ticketId', 'id'],
]);

const isString = (value: unknown): value is string => typeof value === 'string';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringEntry = (entry: [string, unknown]): entry is [string, string] =>
  typeof entry[1] === 'string';
/** The value when it is a string that is not empty. */
const textOf = (value: unknown): string | undefined =>
  isString(value) && value !== '' ? value : undefined;

const isTokenPair = (value: unknown): value is MobileTokens =>
  isRecord(value) &&
  ['tokenType', 'accessToken', 'refreshToken', 'accessExpiresAt', 'refreshExpiresAt'].every((key) =>
    isString(value[key]),
  );

/** The token pair and nothing else: the sign-in routes also answer `requiresTwoFactor`. */
const pairOf = (t: MobileTokens): MobileTokens => ({
  tokenType: t.tokenType,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  accessExpiresAt: t.accessExpiresAt,
  refreshExpiresAt: t.refreshExpiresAt,
});

/** A 401 about the token that was sent: it expired (`unauthorized`) or its session ended. */
const isTokenProblem = (e: unknown): e is MobileApiError =>
  MobileApiError.is(e) &&
  e.status === 401 &&
  (e.code === 'unauthorized' || e.code === 'session_revoked');

/**
 * The platform refused the refresh token itself (revoked, replayed, expired): any 4xx but a 426
 * (the app must update first) and a 429 (slow down), which say nothing about the token.
 */
const isRefusal = (e: unknown): boolean =>
  MobileApiError.is(e) && e.status >= 400 && e.status < 500 && e.status !== 426 && e.status !== 429;

function queryString(query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** The JSON object of an error answer; empty when the body is not one, such as a host's HTML page. */
function envelopeOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** What an answer without a usable `error` is called: the platform's own fallback, or what a 426 is. */
const fallbackCode = (status: number): string =>
  status === 426 ? 'upgrade_required' : status >= 500 ? 'server_error' : 'request_failed';

/**
 * A Retry-After header as seconds: whole seconds, or an HTTP date as the whole seconds until then
 * (rounded up, so a retry is never early, and not below 0). Anything else is null.
 */
function secondsOf(header: string | null): number | null {
  const text = header?.trim() ?? '';
  if (/^\d+$/.test(text)) {
    // Enough digits overflow to Infinity, which is no wait.
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds : null;
  }
  // A date starts with its day name ("Wed, 21 Oct 2026 ..."); Date.parse alone would also take
  // digits such as "-5" for a year.
  if (!/^[A-Za-z]{3,9},/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * The error an answer that is not 2xx ends in, taking from its envelope only what has the right
 * type. A field the call has another name for (`fieldNames`) is keyed by that name.
 */
function errorFrom(
  status: number,
  envelope: Record<string, unknown>,
  retryAfter: string | null,
  fieldNames: ReadonlyMap<string, string> | undefined,
): MobileApiError {
  const { error, message, fields, detail, retryAfterSeconds } = envelope;
  return new MobileApiError(textOf(error) ?? fallbackCode(status), status, textOf(message), {
    fields: isRecord(fields)
      ? Object.fromEntries(
          Object.entries(fields)
            .filter(isStringEntry)
            .map(([key, text]): [string, string] => [fieldNames?.get(key) ?? key, text]),
        )
      : undefined,
    detail: Array.isArray(detail) && detail.every(isString) ? detail : undefined,
    retryAfterSeconds:
      typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds
        : secondsOf(retryAfter),
  });
}

export function createLiveApi(config: LiveApiConfig): PlatformApi {
  const { tokenStore, app, onSignedOut, onUpgradeRequired } = config;
  const root = config.baseUrl.replace(/\/+$/, '');
  const fetchImpl: typeof fetch =
    config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  let refreshing: Promise<MobileTokens> | null = null;

  /** One HTTP exchange: the answer, or the MobileApiError it ended in. No refresh, no retry. */
  async function send<T>(
    route: Route,
    options: RequestOptions,
    bearer: string | undefined,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: options.as === 'text' ? 'text/csv, text/plain' : 'application/json',
      'X-App-Version': app.version,
      'X-App-Platform': app.platform,
      'X-Device-Id': app.deviceId,
    };
    if (app.deviceName) headers['X-Device-Name'] = encodeURIComponent(app.deviceName);
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const init: RequestInit = {
      method: route.method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
    };
    if (route.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body ?? {});
    }

    let res: Response;
    let raw: string;
    try {
      res = await fetchImpl(root + route.path + queryString(options.query), init);
      raw = await res.text();
    } catch {
      throw MobileApiError.network();
    }
    if (!res.ok) {
      const envelope = envelopeOf(raw);
      if (res.status === 426) onUpgradeRequired?.(textOf(envelope.minSupportedAppVersion) ?? '');
      throw errorFrom(res.status, envelope, res.headers.get('Retry-After'), options.fieldNames);
    }
    if (options.as === 'none') return undefined as T;
    if (options.as === 'text') return raw as T;
    let answer: unknown;
    try {
      answer = JSON.parse(raw);
    } catch {
      throw new MobileApiError('server_error', res.status);
    }
    if (!(options.check ?? isRecord)(answer)) {
      throw new MobileApiError('server_error', res.status);
    }
    return answer as T;
  }

  /** A call with the session's rules: refresh and retry on 401, end the session when it is revoked. */
  async function request<T>(route: Route, options: RequestOptions = {}): Promise<T> {
    let stored = options.auth === false ? null : await tokenStore.get();
    // Only the refresh token survives a restart: there is no access token to send yet.
    if (stored?.accessToken === '') stored = await refreshOnce();
    try {
      return await send<T>(route, options, stored?.accessToken);
    } catch (e) {
      // A 401 is about the token only when the call sent one: the sign-in routes answer 401 too.
      if (stored === null || !isTokenProblem(e)) throw e;
      const token = await tokenAfter401(stored.accessToken, e);
      try {
        return await send<T>(route, options, token);
      } catch (again) {
        // The retry is the last try. A revoked session ends here; any other 401 is the answer.
        if (isTokenProblem(again) && again.code === 'session_revoked') await endSession(token);
        throw again;
      }
    }
  }

  /** The access token to retry with after a 401 for `sent`, or the error that says there is none. */
  async function tokenAfter401(sent: string, e: MobileApiError): Promise<string> {
    // A refresh under way is, or is about to be, what replaced `sent`: join it, and its failure.
    if (refreshing !== null) return (await refreshing).accessToken;
    const now = await tokenStore.get();
    // Signed out meanwhile (logout(), or another call's revocation): nothing to refresh with, and
    // no one left to tell.
    if (now === null) throw e;
    // Another call refreshed since this one went out. A refresh token alone (an empty access token)
    // is not a token to send, so it falls through to refreshing with it.
    if (now.accessToken !== '' && now.accessToken !== sent) return now.accessToken;
    if (e.code === 'unauthorized') return (await refreshOnce()).accessToken;
    // session_revoked, and no newer token to try: the session is over.
    await endSession(sent);
    throw e;
  }

  /**
   * The platform ended the session that `sent` belongs to. Forget it and say so, unless the store
   * has moved on since: signed out already, or holding the pair of a newer refresh.
   */
  async function endSession(sent: string): Promise<void> {
    const now = await tokenStore.get();
    if (now?.accessToken !== sent) return;
    await tokenStore.set(null);
    onSignedOut?.('session_revoked');
  }

  /** One refresh at a time: the refresh token works once, so concurrent callers share the request. */
  function refreshOnce(): Promise<MobileTokens> {
    refreshing ??= renew().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function renew(): Promise<MobileTokens> {
    const stored = await tokenStore.get();
    if (stored === null) throw new MobileApiError('unauthorized', 401);
    // The store can change while the platform answers: the investor signs out, or signs in again.
    // The answer then belongs to a session that is over, and must touch nothing of what the store
    // holds now. Its callers still get what it says: the fresh pair, or the refusal.
    const unchanged = async () => (await tokenStore.get())?.refreshToken === stored.refreshToken;
    let fresh: MobileTokens;
    try {
      const answer = await send<MobileTokens>(
        ROUTES.refresh,
        { body: { refreshToken: stored.refreshToken }, check: isTokenPair },
        undefined,
      );
      fresh = pairOf(answer);
    } catch (e) {
      if (isRefusal(e) && (await unchanged())) {
        await tokenStore.set(null);
        onSignedOut?.('refresh_failed');
      }
      throw e;
    }
    if (await unchanged()) await tokenStore.set(fresh);
    return fresh;
  }

  const call = <T>(name: ApiMethod, options?: RequestOptions): Promise<T> =>
    request<T>(ROUTES[name], options);
  /** For a method whose answer (`{ ok: true }` and the like) the interface drops. */
  const callVoid = (name: ApiMethod, options?: RequestOptions): Promise<void> =>
    request<void>(ROUTES[name], { ...options, as: 'none' });

  const api: PlatformApi = {
    mode: 'live',

    login: (body) => call('login', { body, auth: false }),
    loginTwoFactor: async (body) =>
      pairOf(await call<MobileTokens>('loginTwoFactor', { body, auth: false })),
    refresh: () => refreshOnce(),
    logout: async () => {
      try {
        const stored = await tokenStore.get();
        if (stored !== null) {
          // One plain request, so signing out never refreshes, retries or reports a sign-out. The
          // refresh token names the session on its own when there is no access token to send.
          await send(
            ROUTES.logout,
            { body: { refreshToken: stored.refreshToken }, as: 'none' },
            stored.accessToken || undefined,
          );
        }
      } catch {
        // Whatever went wrong, the investor is signed out here: the platform ends the session, or
        // the tokens run out by themselves.
      } finally {
        await tokenStore.set(null);
      }
    },
    brand: () => call('brand', { auth: false }),

    me: () => call('me'),
    setNotificationPrefs: (prefs) => call('setNotificationPrefs', { body: prefs }),
    changePassword: (body) => callVoid('changePassword', { body }),
    setPin: (body) => callVoid('setPin', { body }),
    sessions: async () => (await call<{ sessions: SessionView[] }>('sessions')).sessions,
    revokeSession: (sessionId) => call('revokeSession', { body: { sessionId } }),
    enrollTwoFactor: (body) => call('enrollTwoFactor', { body }),
    enableTwoFactor: (body) => call('enableTwoFactor', { body }),
    disableTwoFactor: (body) => callVoid('disableTwoFactor', { body }),
    closeAccount: (body) => callVoid('closeAccount', { body }),

    dashboard: () => call('dashboard'),
    investments: () => call('investments'),
    investment: (id) => call('investment', { query: { id } }),
    strategies: () => call('strategies'),
    history: () => call('history'),
    statements: (kind) => call('statements', { query: { kind } }),
    statement: (period) => call('statement', { query: { period } }),
    statementCsv: (period) => call('statementCsv', { query: { period }, as: 'text' }),

    notifications: (limit) => call('notifications', { query: { limit } }),
    markRead: (id) => call('markRead', { body: id === undefined ? {} : { id } }),
    pushSubscribe: (subscription) => callVoid('pushSubscribe', { body: subscription }),
    pushUnsubscribe: (endpoint) => callVoid('pushUnsubscribe', { body: { endpoint } }),

    supportTickets: (page) => call('supportTickets', { query: { page } }),
    openTicket: ({ subject, message }) =>
      call('openTicket', { body: { subject, body: message }, fieldNames: OPEN_TICKET_FIELDS }),
    ticket: (id) => call('ticket', { query: { id } }),
    replyTicket: ({ id, message }) =>
      callVoid('replyTicket', {
        body: { ticketId: id, body: message },
        fieldNames: REPLY_TICKET_FIELDS,
      }),

    depositMethods: () => call('depositMethods'),
    manualDeposit: (body) => call('manualDeposit', { body }),
    cardDeposit: (body) => call('cardDeposit', { body }),
    withdrawals: () => call('withdrawals'),
    requestWithdrawal: (body) => call('requestWithdrawal', { body }),
    transfers: () => call('transfers'),
    sendTransfer: (body) => call('sendTransfer', { body }),
    invest: (body) => call('invest', { body }),
    maturityChoice: (body) => callVoid('maturityChoice', { body }),

    kyc: () => call('kyc'),
    submitKyc: (submission) => call('submitKyc', { body: submission }),

    legacyPlan: () => call('legacyPlan'),
    saveLegacyPlan: (body) => call('saveLegacyPlan', { body }),
    previewLegacyPlan: (plan) => call('previewLegacyPlan', { body: { plan } }),
    beneficiaries: () => call('beneficiaries'),
    addBeneficiary: (body) => call('addBeneficiary', { body }),
    updateBeneficiary: (body) => call('updateBeneficiary', { body }),
    removeBeneficiary: (id) => callVoid('removeBeneficiary', { body: { id } }),

    oracleAsk: (body) => call('oracleAsk', { body }),
  };

  // Tests put a session in the store without signing in.
  if (import.meta.env.MODE === 'test') {
    Object.assign(api, { _test_setTokens: (tokens: MobileTokens) => tokenStore.set(tokens) });
  }
  return api;
}
