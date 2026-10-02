// The live PlatformApi: the app's HTTP client for a company's platform under /api/mobile/v1 (the
// platform's docs/MOBILE_API.md). Screens never call fetch; they reach this through src/queries.
//
// The token store answers a StoredSession, and must read its shared part from storage on every
// `get`, make `rotate` and `clear` visible to every later `get`, and write in call order. The
// client ends a session on its own only when the platform revokes it or refuses its refresh, and
// says so through onSignedOut. A 426 tells onUpgradeRequired and keeps the session. Retry logic
// keys on the platform's `code`, never on a status alone: only a 401 `unauthorized` or
// `session_revoked` is ever sent again, and once.

import {
  isPublic,
  OPEN_TICKET_FIELDS,
  REPLY_TICKET_FIELDS,
  ROUTES,
  type Answer,
  type ApiMethod,
  type JsonMethod,
  type Route,
  type TextMethod,
  type VoidMethod,
} from './liveRoutes';
import {
  envelopeOf,
  errorFrom,
  hasSessions,
  isLoginResult,
  isRecord,
  isRefusal,
  isTokenPair,
  isTokenProblem,
  jsonOf,
  pairOf,
  STATEMENT_TYPE,
  storageError,
  textOf,
  withCause,
  type TokenProblem,
} from './liveEnvelope';
import { MobileApiError } from './MobileApiError';
import type { PlatformApi } from './PlatformApi';
import type { MobileTokens, SessionView } from './types';

/**
 * What the token store answers. A sign-in's pair is stored by the session layer under a new
 * sessionKey; the client's rotate() keeps the key and replaces the tokens; clear() forgets
 * everything. accessToken is null when this page has none yet (after a restart): the next
 * signed-in call refreshes first.
 */
export type StoredSession = {
  /** Names the sign-in this session came from; random per sign-in, unchanged by a refresh. */
  readonly sessionKey: string;
  readonly refreshToken: string;
  /** This page's access token for this very sign-in, or null; never one from another sign-in. */
  readonly accessToken: string | null;
};

/**
 * Where the app keeps the session; the tabs share it. The client never starts a session (the
 * session layer's own start(tokens) does, outside this interface), and writes land in call order.
 * A store that rejects makes the call reject `storage_error`, or, where the platform has already
 * answered, is reported beside its answer.
 */
export type TokenStore = {
  /**
   * Reads the shared part (sessionKey, refresh token) from storage every time; never a copy in
   * memory.
   */
  get(): Promise<StoredSession | null>;
  /** After a refresh: the new pair under the same sessionKey. Visible to every later get(). */
  rotate(tokens: MobileTokens): Promise<void>;
  /** Forgets the session. Visible to every later get(). */
  clear(): Promise<void>;
};

/**
 * The tokens a request went out with: an access token, the refresh token stored beside it, and the
 * key of the sign-in they belong to.
 */
type Sent = {
  readonly sessionKey: string;
  readonly accessToken: string;
  readonly refreshToken: string;
};

/** What a refresh gives: the new pair, and the key of the sign-in whose session it renewed. */
type Renewed = { readonly sessionKey: string; readonly tokens: MobileTokens };

/** The tokens of a refreshed session, to send a request with. */
const sentOf = ({ sessionKey, tokens }: Renewed): Sent => ({
  sessionKey,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
});

/** How the app names itself on every request. createLiveApi refuses one it cannot send. */
export type AppIdentity = {
  /** X-App-Version: the package.json version; not empty. */
  version: string;
  /** X-App-Platform. */
  platform: 'web';
  /** X-Device-Id: random per install, 8 to 128 of A-Z a-z 0-9 _ -. */
  deviceId: string;
  /** X-Device-Name, sent percent-encoded; left out when empty. */
  deviceName?: string | undefined;
};

/** Why the client signed the investor out on its own. */
export type SignedOutReason = 'session_revoked' | 'refresh_failed';

/** What createLiveApi takes. It reads it once: a later change to it changes nothing sent. */
export type LiveApiConfig = {
  /** The platform's API root, an absolute http(s) URL ("https://example.com/api/mobile/v1"). */
  baseUrl: string;
  tokenStore: TokenStore;
  app: AppIdentity;
  /** Tests pass their own. The default calls the global fetch at the moment of each call. */
  fetchImpl?: typeof fetch | undefined;
  /**
   * The client ended the session on its own: the platform revoked it (`session_revoked`) or
   * refused its refresh (`refresh_failed`). The store is already cleared (or could not be), and
   * the call that met it still rejects. It runs once per ended session and never for logout(),
   * not even for a call that hears a 401 while a logout is out. Sign out on this callback, not on
   * a rejection: a call can reject `session_revoked` without it (the session was over already,
   * newer tokens were stored, or the store holds another sign-in). The client does not notice
   * closeAccount() or a revokeSession() that answers `current: true`: sign out after those
   * yourself.
   */
  onSignedOut?: ((reason: SignedOutReason) => void) | undefined;
  /**
   * An answer was 426: this app version is no longer served. `minVersion` is the oldest that is,
   * or '' when the answer did not say (an update is required all the same). It runs for every
   * such answer, sign-in and refresh included, so it can run many times; the session is kept.
   */
  onUpgradeRequired?: ((minVersion: string) => void) | undefined;
  /**
   * The store failed to save a pair the platform had just issued (or to be read just before): the
   * calls carry on with the pair, but the store may still hold the refresh token it replaced,
   * which the platform refuses, ending the session, if it is sent again after 30 seconds.
   */
  onStorageError?: ((error: unknown) => void) | undefined;
};

/** What createLiveApi returns: the interface, and in test mode `_test_setTokens`, a rotate(). */
export type LiveApi = PlatformApi & { _test_setTokens?: (tokens: MobileTokens) => Promise<void> };

/** How long a request may take before the client gives up on it (`timeout`). */
const TIMEOUT_MS = 20_000;
/**
 * A refresh's: short enough that the next try, with the same refresh token, still falls within the
 * 30 seconds in which the platform honours a token whose answer was lost.
 */
const REFRESH_TIMEOUT_MS = 15_000;
/** POST /kyc's: its body carries up to 4 MB of camera images. */
const KYC_TIMEOUT_MS = 90_000;

/** What a method puts into its request. */
type RequestParts = {
  /** What a POST sends as JSON; `{}` when left out. */
  body?: object;
  /** Added to the path as a query string; a key whose value is undefined is left out. */
  query?: Readonly<Record<string, string | number | undefined>>;
  /**
   * The interface's name for each field the platform names differently, by the platform's name: an
   * error's `fields` come back under the interface's names, so a screen can map them onto the form
   * fields it owns.
   */
  fieldNames?: ReadonlyMap<string, string>;
  /** How long the request may take; TIMEOUT_MS when left out. */
  timeoutMs?: number;
};

/**
 * How a 2xx answer is read, each a server error when the answer is not of its kind: JSON (the
 * default) that passes `check` (an object unless said otherwise, as every answer of the platform
 * is); text, as CSV or plain text (the statement); or `none`, a `{ ok: true, ...}` the interface
 * drops.
 */
type Reading =
  { as?: 'json'; check?: (answer: unknown) => boolean } | { as: 'text' | 'none'; check?: never };

type RequestOptions = RequestParts & Reading;

/**
 * Runs a config callback. One that throws is reported on its own, as an uncaught error in a
 * microtask, and never replaces what the call that ran it answers.
 */
function notify<A extends unknown[]>(callback: ((...args: A) => void) | undefined, ...args: A) {
  try {
    callback?.(...args);
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

function queryString(query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** The base URL without trailing slashes: a TypeError unless it is an absolute http(s) URL. */
function rootOf(baseUrl: string): string {
  const root = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';
  let protocol: string | undefined;
  try {
    protocol = new URL(root).protocol;
  } catch {
    protocol = undefined;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new TypeError('createLiveApi: baseUrl must be an absolute http or https URL');
  }
  return root;
}

/** X-Device-Id as the platform reads it (CLAUDE.md): anything else it takes for no id at all. */
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** A copy of the app's identity, checked: a TypeError names a field that cannot be sent. */
function identityOf(app: AppIdentity): AppIdentity {
  const copy = { ...app };
  if (textOf(copy.version) === undefined) {
    throw new TypeError('createLiveApi: app.version must be a version, not empty');
  }
  if (typeof copy.deviceId !== 'string' || !DEVICE_ID.test(copy.deviceId)) {
    throw new TypeError('createLiveApi: app.deviceId must be 8 to 128 of A-Z a-z 0-9 _ -');
  }
  return copy;
}

/** A UTF-16 surrogate without its other half, which encodeURIComponent refuses with a URIError. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** X-Device-Name: the name as percent-encoded UTF-8, a lone surrogate as U+FFFD; null: none. */
const nameHeaderOf = (name: string | undefined): string | null =>
  name === undefined || name === ''
    ? null
    : encodeURIComponent(name.replace(LONE_SURROGATE, '\uFFFD'));

/**
 * The PlatformApi of a company's platform. It throws a TypeError at once for a config it cannot
 * send, and every method rejects with a MobileApiError, with two codes of the client's own beside
 * `network`: `timeout` (it gave up waiting; a money call may still have gone through) and
 * `storage_error` (the store failed before the platform was asked). Beyond the interface:
 *  - refresh() resolves the new pair and rotates it into the store; with nothing stored it rejects
 *    `unauthorized` and sends nothing;
 *  - logout() clears the store first, then sends at most one request, whose failure it ignores;
 *    it never refreshes, retries or calls onSignedOut, and rejects only when the store fails;
 *  - login() and loginTwoFactor() store nothing: the session layer stores the pair it signs in
 *    with.
 */
export function createLiveApi(config: LiveApiConfig): LiveApi {
  const { tokenStore, onSignedOut, onUpgradeRequired, onStorageError } = config;
  const root = rootOf(config.baseUrl);
  const app = identityOf(config.app);
  const deviceName = nameHeaderOf(app.deviceName);
  const fetchImpl: typeof fetch =
    config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  let refreshing: Promise<Renewed> | null = null;
  // Counts the sessions this client has ended itself: logout(), a revocation, a refused refresh.
  // A request that began under an earlier count belongs to a session that is over. Across tabs,
  // the store's sessionKey tells one sign-in from the next.
  let generation = 0;

  /**
   * One HTTP exchange and the only fetch: the app headers, the bearer when given, `credentials:
   * 'omit'`, `cache: 'no-store'`, `redirect: 'error'` and a timeout. It resolves the 2xx answer as
   * `options` reads it, or rejects with the error it ends in: the envelope of a non-2xx answer (a
   * 426 also tells onUpgradeRequired), `server_error` for a 2xx that is not its route's answer or
   * whose body was lost, `timeout` when the client gave up, else `network`. No refresh, no retry.
   */
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
    if (deviceName !== null) headers['X-Device-Name'] = deviceName;
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
    const init: RequestInit = {
      method: route.method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      // The platform never redirects, and following one would turn a POST into a GET.
      redirect: 'error',
      signal,
    };
    if (route.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body ?? {});
    }

    let res: Response;
    try {
      res = await fetchImpl(root + route.path + queryString(options.query), init);
    } catch (cause) {
      // A request the client gave up on may still have been carried out (a transfer), so it does
      // not read as offline either.
      throw signal.aborted
        ? new MobileApiError('timeout', 0, undefined, { cause })
        : MobileApiError.network({ cause });
    }
    let raw = '';
    try {
      raw = await res.text();
    } catch (cause) {
      // The platform answered and its body was lost. A 2xx means it acted (a transfer went
      // through), so this is not offline; any other status is read as an empty envelope.
      if (res.ok) throw new MobileApiError('server_error', res.status, undefined, { cause });
    }
    if (!res.ok) {
      const envelope = envelopeOf(raw);
      if (res.status === 426) {
        notify(onUpgradeRequired, textOf(envelope.minSupportedAppVersion) ?? '');
      }
      throw errorFrom(res.status, envelope, res.headers.get('Retry-After'), options.fieldNames);
    }
    // A 2xx answer must be what the route answers; anything else (a host's page, a proxy's empty
    // answer) did not come from it, so the action may not have happened.
    const unlike = () => new MobileApiError('server_error', res.status);
    if (options.as === 'text') {
      if (!STATEMENT_TYPE.test(res.headers.get('Content-Type') ?? '')) throw unlike();
      return raw as T;
    }
    const answer = jsonOf(raw);
    if (options.as === 'none') {
      // Every route whose answer the interface drops answers `{ ok: true, ...}`.
      if (!isRecord(answer) || answer.ok !== true) throw unlike();
      return undefined as T;
    }
    if (!(options.check ?? isRecord)(answer)) throw unlike();
    return answer as T;
  }

  /**
   * A call with the session's rules. A public route goes out without the bearer. A signed-in one
   * reads the store (and refreshes first while there is no access token), sends, and after a 401
   * token problem retries once with what tokenAfter401 gives. A `session_revoked` on the retry
   * goes to endSession; every other failure, a second `unauthorized` included, is the answer.
   */
  async function request<T>(name: ApiMethod, options: RequestOptions = {}): Promise<T> {
    const route = ROUTES[name];
    const gen0 = generation;
    const stored = isPublic(name) ? null : await read();
    let sent: Sent | null = null;
    if (stored !== null) {
      const access = textOf(stored.accessToken);
      // Only the refresh token survives a restart: there is no access token to send yet.
      sent =
        access === undefined
          ? await refreshedFirst(stored, gen0)
          : {
              sessionKey: stored.sessionKey,
              accessToken: access,
              refreshToken: stored.refreshToken,
            };
    }
    try {
      return await send<T>(route, options, sent?.accessToken);
    } catch (e) {
      // A 401 is about the token only when the call sent one: the sign-in routes answer 401 too.
      if (sent === null || !isTokenProblem(e)) throw e;
      const retry = await tokenAfter401(e, gen0, sent);
      try {
        return await send<T>(route, options, retry.accessToken);
      } catch (again) {
        // The retry is the last try. A revoked session ends here; any other 401 is the answer.
        if (isTokenProblem(again) && again.code === 'session_revoked') {
          await endSession(again, gen0, retry);
        }
        throw again;
      }
    }
  }

  /**
   * After the platform answered `e` to a request that began under `gen0` and went out with
   * `sent`: the tokens to retry with, or the error the request ends in. In this order: join a
   * refresh under way; throw `e` untouched once the client has ended a session, the store is
   * empty or it holds another sign-in; retry with a newer access token this tab stored; refresh
   * when another tab rotated the same sign-in's refresh token or the access token expired; end the
   * session when it was revoked and the store holds the same tokens. A refreshed pair is retried
   * with only while it is of the request's sign-in (refreshed).
   */
  async function tokenAfter401(e: TokenProblem, gen0: number, sent: Sent): Promise<Sent> {
    // A refresh under way is, or is about to be, what replaced `sent`: join it, and its failure.
    if (refreshing !== null) return refreshed(e, gen0, sent, refreshing);
    const now = await read(e);
    // The request's session is over: the client ended one since (logout(), a revocation, a
    // refused refresh), the store is empty, or someone signed in since, in this tab or another.
    // Nothing to refresh, and no one left to tell.
    if (generation !== gen0 || now === null || now.sessionKey !== sent.sessionKey) throw e;
    // This tab stored a newer pair since the request went out. A refresh token alone (no access
    // token) is not a token to send, so it falls through to refreshing with it.
    const newer = textOf(now.accessToken);
    if (newer !== undefined && newer !== sent.accessToken) {
      return { sessionKey: now.sessionKey, accessToken: newer, refreshToken: now.refreshToken };
    }
    // Another tab refreshed this same sign-in, so this tab's access token is stale whatever the
    // code says; or the access token expired. Either way: refresh with the stored token.
    if (now.refreshToken !== sent.refreshToken || e.code === 'unauthorized') {
      return refreshed(e, gen0, sent, refreshOnce());
    }
    // session_revoked, and the store holds the very tokens it was said of: the session is over.
    return endSession(e, gen0, sent);
  }

  /**
   * The pair `refresh` gives, to retry a request of `sent`'s sign-in with: only while the client
   * has ended no session since `gen0`, the refresh renewed that sign-in (not an earlier one whose
   * refresh was still out), and the store still holds it once the pair is in. Otherwise `e`,
   * untouched.
   */
  async function refreshed(
    e: TokenProblem,
    gen0: number,
    sent: Sent,
    refresh: Promise<Renewed>,
  ): Promise<Sent> {
    const renewed = await refresh;
    if (renewed.sessionKey === sent.sessionKey) {
      const now = await read(e);
      if (generation === gen0 && now?.sessionKey === sent.sessionKey) return sentOf(renewed);
    }
    throw e;
  }

  /**
   * The refresh a request makes first when the store has no access token for it: the pair, if the
   * client has ended no session since `gen0` and it renewed the sign-in the request read. Otherwise
   * (a logout, or a refresh of an earlier sign-in that was still out) nothing is sent, and the
   * request rejects `unauthorized`.
   */
  async function refreshedFirst(stored: StoredSession, gen0: number): Promise<Sent> {
    const renewed = await refreshOnce();
    if (generation !== gen0 || renewed.sessionKey !== stored.sessionKey) {
      throw new MobileApiError('unauthorized', 401);
    }
    return sentOf(renewed);
  }

  /**
   * The platform revoked the session `sent` belongs to: signOut, but only while the client has
   * ended no session since `gen0` and the store still holds `sent`'s sign-in and both its tokens;
   * otherwise `e` is thrown untouched. Of the calls that hear one revocation together, the first
   * ends the session and the rest find the count changed.
   */
  async function endSession(e: MobileApiError, gen0: number, sent: Sent): Promise<never> {
    const now = await read(e);
    const held =
      now?.sessionKey === sent.sessionKey &&
      now.accessToken === sent.accessToken &&
      now.refreshToken === sent.refreshToken;
    if (generation !== gen0 || !held) throw e;
    return signOut(e, 'session_revoked');
  }

  /**
   * The client ends the session itself: the count moves, the store is cleared and onSignedOut is
   * told, even when the store cannot be cleared. Then `e`, the platform's verdict, is thrown, with
   * the store's failure as its cause if it had one.
   */
  async function signOut(e: MobileApiError, reason: SignedOutReason): Promise<never> {
    generation += 1;
    try {
      await tokenStore.clear();
    } catch (cause) {
      throw withCause(e, cause);
    } finally {
      notify(onSignedOut, reason);
    }
    throw e;
  }

  /**
   * What the store holds. A store that fails is a `storage_error`; once the platform has answered
   * (`verdict`), that answer stands instead, with the store's failure as its cause.
   */
  async function read(verdict?: MobileApiError): Promise<StoredSession | null> {
    try {
      return await tokenStore.get();
    } catch (cause) {
      throw verdict === undefined ? storageError(cause) : withCause(verdict, cause);
    }
  }

  /** One refresh at a time: a refresh token works once, so concurrent calls share the request. */
  function refreshOnce(): Promise<Renewed> {
    refreshing ??= renew().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /**
   * Sends the stored refresh token. A token pair is rotated into the store and resolved, with the
   * key of the sign-in it renewed; a refusal (isRefusal) signs out with `refresh_failed`; any
   * other failure is thrown and keeps the session. When the store has stopped holding that
   * sign-in and its refresh token meanwhile (a logout, a new sign-in, another tab's refresh), the
   * answer touches nothing stored, and its callers still get it. With nothing stored: 401
   * `unauthorized`, and nothing is sent.
   */
  async function renew(): Promise<Renewed> {
    const stored = await read();
    if (stored === null) throw new MobileApiError('unauthorized', 401);
    const unchanged = (now: StoredSession | null) =>
      now?.sessionKey === stored.sessionKey && now.refreshToken === stored.refreshToken;
    let fresh: MobileTokens;
    try {
      const answer = await send<MobileTokens>(
        ROUTES.refresh,
        {
          body: { refreshToken: stored.refreshToken },
          check: isTokenPair,
          timeoutMs: REFRESH_TIMEOUT_MS,
        },
        undefined,
      );
      fresh = pairOf(answer);
    } catch (e) {
      if (isRefusal(e) && unchanged(await read(e))) await signOut(e, 'refresh_failed');
      throw e;
    }
    try {
      if (unchanged(await tokenStore.get())) await tokenStore.rotate(fresh);
    } catch (error) {
      // The platform has rotated the token, so dropping the pair would strand this device: its
      // callers get it all the same, and the store's failure is reported.
      notify(onStorageError, error);
    }
    return { sessionKey: stored.sessionKey, tokens: fresh };
  }

  /** For a method that resolves the JSON the platform answers. */
  const call = <K extends JsonMethod>(
    name: K,
    parts: RequestParts & { check?: (answer: unknown) => boolean } = {},
  ): Promise<Answer<K>> => request<Answer<K>>(name, parts);
  /** For a method whose answer (`{ ok: true }` and the like) the interface drops. */
  const callVoid = (name: VoidMethod, parts: RequestParts = {}): Promise<void> =>
    request<void>(name, { ...parts, as: 'none' });
  /** For the method that resolves text (the statement CSV). */
  const callText = (name: TextMethod, parts: RequestParts = {}): Promise<string> =>
    request<string>(name, { ...parts, as: 'text' });

  const api: LiveApi = {
    mode: 'live',

    login: (body) => call('login', { body, check: isLoginResult }),
    loginTwoFactor: async (body) =>
      pairOf(await call('loginTwoFactor', { body, check: isTokenPair })),
    refresh: async () => (await refreshOnce()).tokens,
    /**
     * Ends the session on this device first, then tells the platform once with the tokens it read,
     * whatever that request meets. A store that could not be read or cleared makes it reject
     * `storage_error` after that.
     */
    logout: async () => {
      let stored: StoredSession | null = null;
      let broken: { cause: unknown } | undefined;
      try {
        stored = await tokenStore.get();
      } catch (cause) {
        broken = { cause };
      }
      // The session ends here, at once: the count moves and the store is cleared in one step, so a
      // call that hears a 401 from now on belongs to an ended session and changes nothing.
      generation += 1;
      try {
        await tokenStore.clear();
      } catch (cause) {
        broken ??= { cause };
      }
      if (stored !== null) {
        try {
          // One plain request, so signing out never refreshes, retries or reports a sign-out. The
          // refresh token names the session on its own when there is no access token to send.
          await send(
            ROUTES.logout,
            { body: { refreshToken: stored.refreshToken }, as: 'none' },
            textOf(stored.accessToken),
          );
        } catch {
          // Whatever went wrong, the investor is signed out here: the platform ends the session,
          // or the tokens run out by themselves.
        }
      }
      if (broken) throw storageError(broken.cause);
    },
    brand: () => call('brand'),

    me: () => call('me'),
    setNotificationPrefs: (prefs) => call('setNotificationPrefs', { body: prefs }),
    changePassword: (body) => callVoid('changePassword', { body }),
    setPin: (body) => callVoid('setPin', { body }),
    // The platform wraps the list.
    sessions: async () =>
      (await request<{ sessions: SessionView[] }>('sessions', { check: hasSessions })).sessions,
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
    statementCsv: (period) => callText('statementCsv', { query: { period } }),

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
    submitKyc: (submission) => call('submitKyc', { body: submission, timeoutMs: KYC_TIMEOUT_MS }),

    legacyPlan: () => call('legacyPlan'),
    saveLegacyPlan: (body) => call('saveLegacyPlan', { body }),
    previewLegacyPlan: (plan) => call('previewLegacyPlan', { body: { plan } }),
    beneficiaries: () => call('beneficiaries'),
    addBeneficiary: (body) => call('addBeneficiary', { body }),
    updateBeneficiary: (body) => call('updateBeneficiary', { body }),
    removeBeneficiary: (id) => callVoid('removeBeneficiary', { body: { id } }),

    oracleAsk: (body) => call('oracleAsk', { body }),
  };

  // Tests rotate the stored session to a pair of their own, keeping its key, without a refresh.
  if (import.meta.env.MODE === 'test') api._test_setTokens = (tokens) => tokenStore.rotate(tokens);
  return api;
}
