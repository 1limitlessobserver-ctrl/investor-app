// Secure storage for the web. Each value is sealed with AES-GCM under one 256-bit key generated on
// this device as non-extractable: the page can use it, but no script can read or export its bytes,
// so a copied value cannot be decrypted anywhere else. The key is kept in IndexedDB (idb-keyval:
// database `investor-app`, store `secure`) under `secure:key`, and each value under
// `secure:<name>` as { iv, data }: a fresh random 12-byte IV and the ciphertext, sealed with its
// name as additional data so it cannot be moved to another name. A value that no longer decrypts
// (its key was lost, or it was changed) reads as null and is removed.

import { createStore, del, get, keys, set } from 'idb-keyval';
import type { SecureStorage } from '../types';

/** The key-value store underneath: IndexedDB in the app, a Map in tests. */
export interface KvStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const PREFIX = 'secure:';
const KEY_ENTRY = `${PREFIX}key`;

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

  /** The one key, shared by every call of this instance; a read that failed is tried again. */
  function theKey(): Promise<CryptoKey> {
    key ??= loadKey(keyStore).catch((error: unknown) => {
      key = undefined;
      throw error;
    });
    return key;
  }

  return {
    async get(name) {
      const entry = entryName(name);
      const sealed = await db.get(entry);
      if (sealed === undefined) return null;
      const cryptoKey = await theKey();
      try {
        return await open(cryptoKey, name, sealed);
      } catch {
        await db.del(entry);
        return null;
      }
    },
    async set(name, value) {
      const entry = entryName(name);
      await db.set(entry, await seal(await theKey(), name, value));
    },
    async remove(name) {
      await db.del(entryName(name));
    },
    async clear() {
      for (const entry of await db.keys()) {
        if (entry.startsWith(PREFIX) && entry !== KEY_ENTRY) await db.del(entry);
      }
    },
  };
}

/** Where a value is kept. `key` is refused: its entry would be the key's own. */
function entryName(name: string): string {
  const entry = `${PREFIX}${name}`;
  if (entry === KEY_ENTRY) throw new Error('"key" is reserved by secure storage.');
  return entry;
}

/** The stored key, or a new one, stored, when there is none (or what is stored is not a key). */
async function loadKey(store: KvStore): Promise<CryptoKey> {
  const stored = await store.get(KEY_ENTRY);
  if (stored instanceof CryptoKey) return stored;
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await store.set(KEY_ENTRY, generated);
  return generated;
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
  };
}
