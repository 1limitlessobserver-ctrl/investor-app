import { describe, it, expect, vi } from 'vitest';
import type { MobileTokens } from '../api/types';
import { createSecureStorage } from '../platform/web/storage';
import type { SecureStorage } from '../platform/types';
import { memoryKvStore } from '../test/memoryKvStore';
import { createTokenStore, type SessionChannel, type TokenStoreEvent } from './tokens';

const pair = {
  tokenType: 'Bearer' as const,
  accessToken: 'a1',
  refreshToken: 'r1',
  accessExpiresAt: '2026-10-01T12:15:00.000Z',
  refreshExpiresAt: '2026-10-31T12:00:00.000Z',
};
const next = (n: number): MobileTokens => ({
  ...pair,
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
});

/** Two tabs share IndexedDB: SecureStorage instances over the same KvStore. */
function sharedStorage() {
  const db = memoryKvStore();
  return { db, open: () => createSecureStorage({ db }) };
}

/** A LockManager shared by every "tab" of a test: one callback at a time, in request order. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const state = { held: false, names: [] as string[] };
  const request = (name: string, callback: (lock: Lock | null) => unknown) => {
    state.names.push(name);
    const run = tail.then(async () => {
      state.held = true;
      try {
        return await callback(null);
      } finally {
        state.held = false;
      }
    });
    tail = run.catch(() => undefined);
    return run;
  };
  // The store calls request(name, callback) only, the first of LockManager's two forms.
  return { state, request: request as LockManager['request'] };
}

/**
 * BroadcastChannel stand-ins on one bus: a message reaches every other open channel as a later
 * task, as a structured clone; `settle()` waits for the deliveries under way.
 */
function fakeBus() {
  type Channel = SessionChannel & { listeners: Set<(event: MessageEvent) => void> };
  const open = new Set<Channel>();
  let deliveries: Promise<void>[] = [];
  const closed = vi.fn();
  return {
    closed,
    count: () => open.size,
    channel(): SessionChannel {
      const channel: Channel = {
        listeners: new Set(),
        postMessage(message) {
          for (const other of open) {
            if (other === channel) continue;
            const data: unknown = structuredClone(message);
            deliveries.push(
              new Promise((resolve) =>
                setTimeout(() => {
                  if (open.has(other)) {
                    for (const listener of other.listeners) {
                      listener(new MessageEvent('message', { data }));
                    }
                  }
                  resolve();
                }, 0),
              ),
            );
          }
        },
        addEventListener(_type, listener) {
          channel.listeners.add(listener);
        },
        close() {
          open.delete(channel);
          closed();
        },
      };
      open.add(channel);
      return channel;
    },
    /** Sends a message as another tab would, malformed ones included. */
    post(message: unknown) {
      const sender = this.channel();
      sender.postMessage(message);
      sender.close();
    },
    async settle() {
      while (deliveries.length > 0) {
        const now = deliveries;
        deliveries = [];
        await Promise.all(now);
      }
    },
  };
}

describe('token store', () => {
  it('keeps the access token in memory and the refresh token in secure storage', async () => {
    const db = memoryKvStore();
    const store = createTokenStore(createSecureStorage({ db }));
    await store.start(pair);
    expect(store.peekAccess()).toBe('a1');
    const again = createTokenStore(createSecureStorage({ db }));
    const t = await again.get();
    expect(t?.refreshToken).toBe('r1');
    expect(t?.accessToken).toBeNull(); // gone with the old instance: the first call refreshes
    await again.clear();
    expect(await again.get()).toBeNull();
  });

  it('stores one value, the key and the refresh token, never the access token', async () => {
    const shared = sharedStorage();
    const store = createTokenStore(shared.open(), { randomKey: () => 'key-1' });
    await store.start(pair);
    const raw = await shared.open().get('session');
    expect(JSON.parse(raw ?? 'null')).toEqual({ sessionKey: 'key-1', refreshToken: 'r1' });
    expect(await store.get()).toEqual({
      sessionKey: 'key-1',
      refreshToken: 'r1',
      accessToken: 'a1',
    });
  });

  it('gives every sign-in a new random 16-byte key', async () => {
    const store = createTokenStore(sharedStorage().open());
    await store.start(pair);
    const first = (await store.get())?.sessionKey;
    await store.start(next(2));
    const second = (await store.get())?.sessionKey;
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).not.toBe(first);
  });

  it('answers the key it made, so the session layer knows which sign-in it holds', async () => {
    const store = createTokenStore(sharedStorage().open(), { randomKey: () => 'key-1' });
    expect(await store.start(pair)).toBe('key-1');
    expect((await store.get())?.sessionKey).toBe('key-1');
  });

  it('reads storage each time: after a refresh in another tab, this one has no token', async () => {
    const shared = sharedStorage();
    const tabA = createTokenStore(shared.open(), { channel: null });
    const tabB = createTokenStore(shared.open(), { channel: null });
    await tabA.start(pair);
    const key = (await tabA.get())?.sessionKey ?? '';
    expect(await tabB.rotate(next(2), key)).toBe(true);
    expect(await tabA.get()).toEqual({ sessionKey: key, refreshToken: 'r2', accessToken: null });
    expect(await tabB.get()).toEqual({ sessionKey: key, refreshToken: 'r2', accessToken: 'a2' });
  });

  it('rotates and clears only the session whose key it is given', async () => {
    const store = createTokenStore(sharedStorage().open(), { randomKey: () => 'key-1' });
    await store.start(pair);
    expect(await store.rotate(next(2), 'key-other')).toBe(false);
    expect(await store.clear('key-other')).toBe(false);
    expect(await store.get()).toEqual({
      sessionKey: 'key-1',
      refreshToken: 'r1',
      accessToken: 'a1',
    });
    expect(await store.rotate(next(2), 'key-1')).toBe(true);
    expect(store.peekAccess()).toBe('a2');
    expect(await store.get()).toEqual({
      sessionKey: 'key-1',
      refreshToken: 'r2',
      accessToken: 'a2',
    });
    expect(await store.clear('key-1')).toBe(true);
    expect(store.peekAccess()).toBeNull();
    expect(await store.get()).toBeNull();
    expect(await store.rotate(next(3), 'key-1')).toBe(false);
    expect(await store.get()).toBeNull();
  });

  it('forgets its pair on a keyed clear of its sign-in that finds another one stored', async () => {
    const shared = sharedStorage();
    let n = 0;
    const randomKey = () => `key-${++n}`;
    const tabA = createTokenStore(shared.open(), { channel: null, randomKey });
    const tabB = createTokenStore(shared.open(), { channel: null, randomKey });
    await tabA.start(pair); // key-1
    await tabB.start(next(5)); // key-2, which tab A never hears of
    expect(await tabA.clear('key-1')).toBe(false);
    expect(tabA.peekAccess()).toBeNull();
    expect(await tabB.get()).toEqual({
      sessionKey: 'key-2',
      refreshToken: 'r5',
      accessToken: 'a5',
    });
  });

  it('forgets an older pair it holds once it clears the newer sign-in stored', async () => {
    const shared = sharedStorage();
    let n = 0;
    const randomKey = () => `key-${++n}`;
    const tabA = createTokenStore(shared.open(), { channel: null, randomKey });
    const tabB = createTokenStore(shared.open(), { channel: null, randomKey });
    await tabA.start(pair); // key-1
    await tabB.start(next(5)); // key-2, which tab A never hears of
    expect(await tabA.clear('key-2')).toBe(true);
    expect(tabA.peekAccess()).toBeNull();
  });

  it('forgets its pair on a keyed clear of its sign-in that finds nothing stored', async () => {
    const shared = sharedStorage();
    const store = createTokenStore(shared.open(), { channel: null, randomKey: () => 'key-1' });
    await store.start(pair);
    await shared.open().remove('session'); // another tab signed out, unheard
    expect(await store.clear('key-1')).toBe(false);
    expect(store.peekAccess()).toBeNull();
  });

  it.each([
    ['of its sign-in', 'key-1'],
    ['given no key', undefined],
  ])('forgets its pair on a clear %s whose read fails', async (_, key) => {
    const real = sharedStorage().open();
    let broken = false;
    const failing: SecureStorage = {
      ...real,
      get: (name) => (broken ? Promise.reject(new Error('disk error')) : real.get(name)),
    };
    const store = createTokenStore(failing, { channel: null, randomKey: () => 'key-1' });
    await store.start(pair);
    broken = true;
    await expect(store.clear(key)).rejects.toThrow('disk error');
    expect(store.peekAccess()).toBeNull();
  });

  it('clears whatever is stored when given no key, and says when there was nothing', async () => {
    const store = createTokenStore(sharedStorage().open());
    expect(await store.clear()).toBe(false);
    await store.start(pair);
    expect(await store.clear()).toBe(true);
    expect(await store.get()).toBeNull();
    expect(await store.clear()).toBe(false);
  });

  it('compares and writes inside the shared Web Lock', async () => {
    const shared = sharedStorage();
    const locks = fakeLocks();
    const storage = shared.open();
    const outside: string[] = [];
    const watched: SecureStorage = {
      ...storage,
      get: (name) => {
        if (!locks.state.held) outside.push(`get ${name}`);
        return storage.get(name);
      },
      set: (name, value) => {
        if (!locks.state.held) outside.push(`set ${name}`);
        return storage.set(name, value);
      },
      remove: (name) => {
        if (!locks.state.held) outside.push(`remove ${name}`);
        return storage.remove(name);
      },
    };
    const store = createTokenStore(watched, { locks, channel: null, randomKey: () => 'key-1' });
    await store.start(pair);
    await store.rotate(next(2), 'key-1');
    await store.clear('key-1');
    await store.clear();
    expect(outside).toEqual([]);
    expect(locks.state.names).toEqual(Array(4).fill('investor-app-session'));
  });

  it('lets a sign-in in another tab win over this tab’s refresh of the old session', async () => {
    const shared = sharedStorage();
    const locks = fakeLocks();
    let n = 0;
    const randomKey = () => `key-${++n}`;
    const tabA = createTokenStore(shared.open(), { locks, channel: null, randomKey });
    const tabB = createTokenStore(shared.open(), { locks, channel: null, randomKey });
    await tabA.start(pair);
    const [started, rotated] = await Promise.all([
      tabB.start(next(5)),
      tabA.rotate(next(2), 'key-1'),
    ]);
    expect(started).toBe('key-2');
    expect(rotated).toBe(false);
    expect(await tabB.get()).toEqual({
      sessionKey: 'key-2',
      refreshToken: 'r5',
      accessToken: 'a5',
    });
  });

  it('without Web Locks runs its own calls one at a time, in call order', async () => {
    const store = createTokenStore(sharedStorage().open(), {
      locks: null,
      channel: null,
      randomKey: () => 'key-1',
    });
    await store.start(pair);
    const [cleared, rotated] = await Promise.all([
      store.clear('key-1'),
      store.rotate(next(2), 'key-1'),
    ]);
    expect(cleared).toBe(true);
    expect(rotated).toBe(false);
    expect(await store.get()).toBeNull();
  });

  it('reads a stored value it cannot parse as no session', async () => {
    const shared = sharedStorage();
    await shared.open().set('session', '{"sessionKey": 42}');
    expect(await createTokenStore(shared.open()).get()).toBeNull();
    await shared.open().set('session', 'not json');
    expect(await createTokenStore(shared.open()).get()).toBeNull();
  });

  it('forgets the access token on a sign-out whose removal from storage fails', async () => {
    const real = sharedStorage().open();
    const failing: SecureStorage = {
      ...real,
      remove: () => Promise.reject(new Error('disk full')),
    };
    const store = createTokenStore(failing, { channel: null, randomKey: () => 'key-1' });
    await store.start(pair);
    await expect(store.clear()).rejects.toThrow('disk full');
    expect(store.peekAccess()).toBeNull();
    expect((await store.get())?.accessToken).toBeNull();
  });

  it('works on without the other tabs when their channel cannot be opened', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('no channel');
    const store = createTokenStore(sharedStorage().open(), {
      channel: () => {
        throw failure;
      },
      randomKey: () => 'key-1',
    });
    const stop = store.subscribe(() => {});
    expect(await store.start(pair)).toBe('key-1');
    stop();
    expect(warn).toHaveBeenCalledWith('[investor-app] opening the session channel:', failure);
    warn.mockRestore();
  });

  it('keeps a sign-in whose news cannot be sent to the other tabs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new DOMException('The channel is closed.', 'InvalidStateError');
    const channel: SessionChannel = {
      postMessage: () => {
        throw failure;
      },
      addEventListener: () => {},
      close: () => {},
    };
    const store = createTokenStore(sharedStorage().open(), {
      channel: () => channel,
      randomKey: () => 'key-1',
    });
    store.subscribe(() => {});
    expect(await store.start(pair)).toBe('key-1');
    expect(await store.rotate(next(2), 'key-1')).toBe(true);
    expect(await store.clear('key-1')).toBe(true);
    expect(warn).toHaveBeenCalledWith('[investor-app] telling the other tabs:', failure);
    warn.mockRestore();
  });

  it('passes a storage failure on, so the client can report it', async () => {
    const db = memoryKvStore();
    db.raw.set('secure:key', 'not a CryptoKey');
    const store = createTokenStore(createSecureStorage({ db }));
    await expect(store.get()).rejects.toThrow('The secure storage key cannot be read.');
    await expect(store.start(pair)).rejects.toThrow('The secure storage key cannot be read.');
    expect(store.peekAccess()).toBeNull();
  });
});

describe('token store across tabs', () => {
  function twoTabs() {
    const shared = sharedStorage();
    const bus = fakeBus();
    const locks = fakeLocks();
    let n = 0;
    const options = { locks, channel: () => bus.channel(), randomKey: () => `key-${++n}` };
    const tabA = createTokenStore(shared.open(), options);
    const tabB = createTokenStore(shared.open(), options);
    const heardA: TokenStoreEvent[] = [];
    const heardB: TokenStoreEvent[] = [];
    const stopA = tabA.subscribe((event) => heardA.push(event));
    const stopB = tabB.subscribe((event) => heardB.push(event));
    /** The messages delivered, and what each tab made of them (a read of its storage). */
    async function settle() {
      await bus.settle();
      await Promise.all([tabA.get(), tabB.get()]);
    }
    return { shared, bus, tabA, tabB, heardA, heardB, stopA, stopB, settle };
  }

  it('hands another tab’s refreshed pair to this tab, so it need not refresh too', async () => {
    const { tabA, tabB, heardA, heardB, settle } = twoTabs();
    await tabA.start(pair);
    await settle();
    await tabA.rotate(next(2), 'key-1');
    await settle();
    expect(tabB.peekAccess()).toBe('a2');
    expect(await tabB.get()).toEqual({
      sessionKey: 'key-1',
      refreshToken: 'r2',
      accessToken: 'a2',
    });
    expect(heardA).toEqual([]);
    expect(heardB).toEqual([{ type: 'start', sessionKey: 'key-1' }]);
  });

  it('tells this tab when another tab signs in or out, and forgets its access token', async () => {
    const { tabA, tabB, heardB, settle } = twoTabs();
    await tabB.start(next(7));
    await tabA.start(pair);
    await settle();
    expect(heardB).toEqual([{ type: 'start', sessionKey: 'key-2' }]);
    expect(tabB.peekAccess()).toBeNull();
    await tabA.clear();
    await settle();
    expect(heardB).toEqual([
      { type: 'start', sessionKey: 'key-2' },
      { type: 'clear', sessionKey: 'key-2' },
    ]);
    expect(await tabB.get()).toBeNull();
  });

  it('pays no heed to news that a newer sign-in has overtaken', async () => {
    const { bus, tabA, tabB, heardA, heardB, settle } = twoTabs();
    await tabB.start(next(7)); // key-1: its news is still on the way to tab A
    await tabA.start(pair); // key-2, stored last
    await settle();
    expect(heardA).toEqual([]);
    expect(await tabA.get()).toEqual({
      sessionKey: 'key-2',
      refreshToken: 'r1',
      accessToken: 'a1',
    });
    expect(heardB).toEqual([{ type: 'start', sessionKey: 'key-2' }]);
    await tabB.clear('key-1'); // no longer stored: nothing happens, nothing is said
    await tabB.start(next(8)); // key-3
    bus.post({ type: 'clear', sessionKey: 'key-2' }); // late news of a sign-out
    await settle();
    expect(heardA).toEqual([{ type: 'start', sessionKey: 'key-3' }]);
  });

  it('takes up the pair another tab refreshed, while it holds that session itself', async () => {
    const { tabA, tabB, settle } = twoTabs();
    await tabB.start(pair); // key-1: this tab holds its pair
    await settle(); // the other tab hears of the sign-in, and holds no access token
    await tabA.rotate(next(2), 'key-1'); // so it refreshes, and says so
    await settle();
    expect(tabB.peekAccess()).toBe('a2');
    expect((await tabB.get())?.accessToken).toBe('a2');
  });

  it('hears another tab sign in or out though it cannot read storage to check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { shared, bus, tabA, settle } = twoTabs();
    const real = shared.open();
    let broken = false;
    const failing: SecureStorage = {
      ...real,
      get: (key) => (broken ? Promise.reject(new Error('unreadable')) : real.get(key)),
    };
    const tabC = createTokenStore(failing, { channel: () => bus.channel(), locks: null });
    const heardC: TokenStoreEvent[] = [];
    tabC.subscribe((event) => heardC.push(event));
    await tabA.start(pair); // key-1
    broken = true;
    await settle();
    await vi.waitFor(() => expect(heardC).toEqual([{ type: 'start', sessionKey: 'key-1' }]));
    await tabA.clear('key-1');
    await bus.settle();
    await vi.waitFor(() => expect(heardC).toHaveLength(2));
    expect(heardC[1]).toEqual({ type: 'clear', sessionKey: 'key-1' });
    expect(warn).toHaveBeenCalledWith(
      '[investor-app] checking another tab’s news against storage:',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('keeps its own pair when another tab refreshes a session it no longer holds', async () => {
    const { bus, tabA, tabB, settle } = twoTabs();
    await tabA.start(pair); // key-1
    await settle();
    await tabB.start(next(5)); // key-2, which replaces it
    bus.post({ type: 'rotate', sessionKey: 'key-1', accessToken: 'a9', refreshToken: 'r9' });
    await settle();
    expect(tabB.peekAccess()).toBe('a5');
  });

  it('ignores messages it does not understand', async () => {
    const { bus, tabB, heardB, settle } = twoTabs();
    await tabB.start(pair);
    for (const junk of [null, 'start', { type: 'wipe' }, { type: 'rotate', sessionKey: 'key-1' }]) {
      bus.post(junk);
    }
    await settle();
    expect(heardB).toEqual([]);
    expect(tabB.peekAccess()).toBe('a1');
  });

  it('opens its channel with the first listener and closes it with the last', () => {
    const { bus, stopA, stopB } = twoTabs();
    expect(bus.count()).toBe(2);
    stopA();
    stopB();
    expect(bus.count()).toBe(0);
    expect(bus.closed).toHaveBeenCalledTimes(2);
  });
});
