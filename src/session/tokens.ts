// The token store the live client keeps the session in (TokenStore in src/api/createLiveApi.ts),
// over the platform's secure storage. One JSON value under `session` holds what the tabs share:
// the sign-in's random key and its refresh token. The access token never reaches storage: it
// lives in this page's memory, beside the refresh token it came with, so a page that restarts, or
// whose refresh token another tab has since replaced, has none and the client refreshes first.
//
// Writes compare the session key and write inside one critical section: a Web Lock shared by the
// tabs where the browser has them, else this store's own queue. A BroadcastChannel tells the other
// tabs of every write: a refreshed pair of the session they hold is taken up into their memory
// (so each tab need not refresh in turn), and a new sign-in or a sign-out empties it and is passed
// to the session layer through subscribe().
//
// The rotate message carries the pair itself, the access token included. That gives away nothing:
// a BroadcastChannel reaches only this origin's pages, and any of them can already decrypt the
// refresh token, as secure storage's key belongs to the origin too. Sending it spares each tab a
// refresh of its own, which would rotate the token again under the others.

import type { StoredSession, TokenStore } from '../api/createLiveApi';
import type { MobileTokens } from '../api/types';
import { base64url } from '../lib/base64url';
import type { SecureStorage } from '../platform/types';

/** The secure-storage entry, the Web Lock and the channel. */
const ENTRY = 'session';
const NAME = 'investor-app-session';

/** What another tab did that this page must act on, and to which sign-in (its session key). */
export type TokenStoreEvent = { type: 'start' | 'clear'; sessionKey: string };

/** The part of a BroadcastChannel the store uses; tests pass their own. */
export interface SessionChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface TokenStoreOptions {
  /** Opens the channel to the other tabs; null: none (the default where there is no channel). */
  channel?: (() => SessionChannel | null) | null | undefined;
  /** The tabs' shared lock; null: none, this store's own queue (the default without Web Locks). */
  locks?: Pick<LockManager, 'request'> | null | undefined;
  /** A new session key; 16 random bytes in base64url unless a test says otherwise. */
  randomKey?: (() => string) | undefined;
}

export interface SessionTokenStore extends TokenStore {
  /**
   * Stores a sign-in's pair under a new session key, replacing whatever was stored, and tells the
   * other tabs. Resolves the key, which names this sign-in from now on.
   */
  start(tokens: MobileTokens): Promise<string>;
  /** This page's access token, without reading storage; null when it has none. */
  peekAccess(): string | null;
  /**
   * Hears another tab sign in (`start`) or out (`clear`). While anyone listens, the store also
   * takes up the pairs other tabs refresh. Returns the way to stop listening.
   */
  subscribe(listener: (event: TokenStoreEvent) => void): () => void;
}

/** What one tab tells the others. */
type Message =
  | { type: 'start' | 'clear'; sessionKey: string }
  | { type: 'rotate'; sessionKey: string; accessToken: string; refreshToken: string };

/** This page's pair: the access token and the refresh token it was stored with. */
type Held = { sessionKey: string; accessToken: string; refreshToken: string };

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function shared(raw: string | null): { sessionKey: string; refreshToken: string } | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { sessionKey, refreshToken } = value as Record<string, unknown>;
  return isText(sessionKey) && isText(refreshToken) ? { sessionKey, refreshToken } : null;
}

function messageOf(data: unknown): Message | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, sessionKey, accessToken, refreshToken } = data as Record<string, unknown>;
  if (!isText(sessionKey)) return null;
  if (type === 'start' || type === 'clear') return { type, sessionKey };
  if (type === 'rotate' && isText(accessToken) && isText(refreshToken)) {
    return { type, sessionKey, accessToken, refreshToken };
  }
  return null;
}

function openBroadcastChannel(): SessionChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME);
}

function webLocks(): Pick<LockManager, 'request'> | null {
  return typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null;
}

export function createTokenStore(
  storage: SecureStorage,
  options: TokenStoreOptions = {},
): SessionTokenStore {
  const openChannel = options.channel === undefined ? openBroadcastChannel : options.channel;
  const locks = options.locks === undefined ? webLocks() : options.locks;
  const randomKey =
    options.randomKey ?? (() => base64url.encode(crypto.getRandomValues(new Uint8Array(16))));
  let held: Held | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: TokenStoreEvent) => void>();
  let channel: SessionChannel | null = null;

  /** Runs `task` alone: under the tabs' lock, or after this store's earlier tasks. */
  async function exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (locks) return await locks.request(NAME, task);
    const run = queue.catch(() => undefined).then(task);
    queue = run.catch(() => undefined);
    return await run;
  }

  async function read() {
    return shared(await storage.get(ENTRY));
  }

  function tell(message: Message) {
    channel?.postMessage(message);
  }

  /**
   * Another tab's news. A refreshed pair of the session this page holds is taken up at once (get()
   * still checks it against storage). A sign-in or out counts while storage still says so, not
   * once a newer sign-in has overtaken it; a storage that cannot be read passes it on, as the
   * session layer then reads storage itself.
   */
  function hear(event: MessageEvent) {
    const message = messageOf(event.data);
    if (message === null) return;
    if (message.type === 'rotate') {
      if (held === null || held.sessionKey === message.sessionKey) {
        const { sessionKey, accessToken, refreshToken } = message;
        held = { sessionKey, accessToken, refreshToken };
      }
      return;
    }
    const { type, sessionKey } = message;
    void read()
      .then(
        (stored) => (type === 'start' ? stored?.sessionKey === sessionKey : stored === null),
        () => true,
      )
      .then((current) => {
        if (!current) return;
        held = null;
        for (const listener of [...listeners]) listener({ type, sessionKey });
      });
  }

  return {
    async get(): Promise<StoredSession | null> {
      const stored = await read();
      if (stored === null) return null;
      const mine =
        held !== null &&
        held.sessionKey === stored.sessionKey &&
        held.refreshToken === stored.refreshToken
          ? held
          : null;
      return { ...stored, accessToken: mine?.accessToken ?? null };
    },

    start: (tokens) =>
      exclusive(async () => {
        const sessionKey = randomKey();
        const { accessToken, refreshToken } = tokens;
        await storage.set(ENTRY, JSON.stringify({ sessionKey, refreshToken }));
        held = { sessionKey, accessToken, refreshToken };
        tell({ type: 'start', sessionKey });
        return sessionKey;
      }),

    rotate: (tokens, sessionKey) =>
      exclusive(async () => {
        if ((await read())?.sessionKey !== sessionKey) return false;
        const { accessToken, refreshToken } = tokens;
        await storage.set(ENTRY, JSON.stringify({ sessionKey, refreshToken }));
        held = { sessionKey, accessToken, refreshToken };
        tell({ type: 'rotate', sessionKey, accessToken, refreshToken });
        return true;
      }),

    clear: (sessionKey) =>
      exclusive(async () => {
        const stored = await read();
        if (sessionKey !== undefined && stored?.sessionKey !== sessionKey) return false;
        // Forgotten first: whatever storage does next, this page sends the access token no more.
        held = null;
        if (stored === null) return false;
        await storage.remove(ENTRY);
        tell({ type: 'clear', sessionKey: stored.sessionKey });
        return true;
      }),

    peekAccess: () => held?.accessToken ?? null,

    subscribe(listener) {
      listeners.add(listener);
      if (channel === null && openChannel !== null) {
        channel = openChannel();
        channel?.addEventListener('message', hear);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && channel !== null) {
          channel.close();
          channel = null;
        }
      };
    },
  };
}
