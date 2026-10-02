// Secure storage for the web. Each value is sealed with AES-GCM under one 256-bit key generated on
// this device as non-extractable: scripts can use the key but cannot read or export its bytes. The
// browser still keeps those bytes in this profile (Chromium and Firefox persist them with the
// IndexedDB entry), so the sealing protects a value copied out of storage and stops a script from
// carrying the key away; it does not protect against a copy of the whole browser profile.
//
// The key is kept in IndexedDB (idb-keyval: database `investor-app`, store `secure`) under
// `secure:key`, committed in one transaction so that instances starting together keep one key. A
// stored key that cannot be read (browsers read a value they cannot deserialise as null) is never
// replaced: every call rejects until reset() removes the values and the key.
//
// Each value is kept under `secure:<name>` as { iv, data }: a fresh random 12-byte IV and the
// ciphertext, sealed with its name as additional data so it cannot be moved to another name. An
// instance runs its calls one at a time, in call order. A value that no longer decrypts (its key
// was lost, or it was changed) reads as null and is removed.

import { createStore, del, get, keys, set, update } from 'idb-keyval';
import type { SecureStorage } from '../types';

/** The key-value store underneath: IndexedDB in the app, a Map in tests. */
export interface KvStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /**
   * Replaces the value with `updater(old)` in one transaction, and answers what it stored. An
   * updater that throws stores nothing, and the call rejects with its error.
   */
  update<T>(key: string, updater: (old: T | undefined) => T): Promise<T>;
}

const PREFIX = 'secure:';
const KEY_ENTRY = `${PREFIX}key`;
const KEY_UNREADABLE = 'The secure storage key cannot be read.';

/** What a value is kept as. */
interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * `db` holds the sealed values and `keyStore` the key; `keyStore` defaults to `db`, and `db` to
 * IndexedDB.
 */
export function createSecureStorage(
  opts: { db?: KvStore | undefined; keyStore?: KvStore | undefined } = {},
): SecureStorage {
  const db = opts.db ?? indexedDbStore();
  const keyStore = opts.keyStore ?? db;
  let key: Promise<CryptoKey> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs this instance's calls one at a time in call order: a clear() waits for a set(). The queue
   * goes on after a call that failed, and only the caller sees the failure: a call that nobody
   * waits for still rejects unhandled.
   */
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const settled = queue.then(task).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    queue = settled;
    return settled.then((outcome) => {
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    });
  }

  /** The one key, shared by every call of this instance; a read that failed is tried again. */
  function theKey(): Promise<CryptoKey> {
    key ??= loadKey(keyStore).catch((error: unknown) => {
      key = undefined;
      throw error;
    });
    return key;
  }

  return {
    get: (name) =>
      inOrder(async () => {
        const entry = entryName(name);
        const cryptoKey = await theKey();
        const sealed = await db.get(entry);
        if (sealed === undefined) return null;
        try {
          return await open(cryptoKey, name, sealed);
        } catch {
          // Another instance may have stored a different key since this one read it: adopt the
          // stored key and try once more before calling the value stale. (IndexedDB answers a new
          // object on every read, so there the second try always runs.) A stored key that cannot be
          // read stops the call here, with the value kept.
          const stored = await storedKey(keyStore);
          if (stored && stored !== cryptoKey) {
            key = Promise.resolve(stored);
            try {
              return await open(stored, name, sealed);
            } catch {
              // Stale under the stored key too.
            }
          }
          await db.del(entry);
          return null;
        }
      }),
    set: (name, value) =>
      inOrder(async () => {
        const entry = entryName(name);
        await db.set(entry, await seal(await theKey(), name, value));
      }),
    remove: (name) =>
      inOrder(async () => {
        const entry = entryName(name);
        await theKey(); // like every call, refused while the stored key cannot be read
        await db.del(entry);
      }),
    clear: () =>
      inOrder(async () => {
        await theKey();
        for (const entry of await db.keys()) {
          if (entry.startsWith(PREFIX) && entry !== KEY_ENTRY) await db.del(entry);
        }
      }),
    reset: () =>
      inOrder(async () => {
        key = undefined;
        for (const entry of await db.keys()) {
          if (entry.startsWith(PREFIX)) await db.del(entry);
        }
        if (keyStore !== db) await keyStore.del(KEY_ENTRY);
      }),
  };
}

/** Where a value is kept. `key` is refused: its entry would be the key's own. */
function entryName(name: string): string {
  const entry = `${PREFIX}${name}`;
  if (entry === KEY_ENTRY) throw new Error('"key" is reserved by secure storage.');
  return entry;
}

/** The key stored, or undefined when there is none; throws when what is stored is not a key. */
async function storedKey(store: KvStore): Promise<CryptoKey | undefined> {
  const stored = await store.get(KEY_ENTRY);
  if (stored === undefined || stored instanceof CryptoKey) return stored;
  throw new Error(KEY_UNREADABLE);
}

/**
 * The stored key; when there is none, a new one, committed in one transaction that keeps a key
 * another instance stored first. Either way, the key that is stored. Something stored that is not
 * a key is never replaced: that throws.
 */
async function loadKey(store: KvStore): Promise<CryptoKey> {
  const stored = await storedKey(store);
  if (stored) return stored;
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const committed = await store.update<unknown>(KEY_ENTRY, (current) => {
    if (current === undefined) return generated;
    if (current instanceof CryptoKey) return current;
    throw new Error(KEY_UNREADABLE); // stores nothing
  });
  return committed as CryptoKey;
}

async function seal(key: CryptoKey, name: string, value: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(name);
  const plain = new TextEncoder().encode(value);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plain);
  return { iv, data: new Uint8Array(data) };
}

/** Throws when the value does not decrypt: the wrong key, another name, or changed bytes. */
async function open(key: CryptoKey, name: string, sealed: unknown): Promise<string> {
  const { iv, data } = sealed as Sealed;
  const additionalData = new TextEncoder().encode(name);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, data);
  return new TextDecoder().decode(plain);
}

function indexedDbStore(): KvStore {
  const store = createStore('investor-app', 'secure');
  return {
    get: (key) => get<unknown>(key, store),
    set: (key, value) => set(key, value, store),
    del: (key) => del(key, store),
    keys: async () => (await keys(store)).filter((key) => typeof key === 'string'),
    update: async <T>(key: string, updater: (old: T | undefined) => T) => {
      const result: { stored?: T } = {};
      await update<T>(key, (old) => (result.stored = updater(old)), store);
      return result.stored as T;
    },
  };
}
