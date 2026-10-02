import { describe, it, expect, vi } from 'vitest';
import { clear, createStore, get } from 'idb-keyval';
import { createSecureStorage, type KvStore } from './storage';
import { memoryKvStore } from '../../test/memoryKvStore';

function memoryStore(): KvStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: (k) => Promise.resolve(raw.get(k)),
    set: (k, v) => {
      raw.set(k, v);
      return Promise.resolve();
    },
    del: (k) => {
      raw.delete(k);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...raw.keys()]),
    update: <T>(k: string, updater: (old: T | undefined) => T) => {
      const next = updater(raw.get(k) as T | undefined);
      raw.set(k, next);
      return Promise.resolve(next);
    },
  };
}

describe('secure storage', () => {
  it('round-trips a value and never stores it in plain text', async () => {
    const db = memoryStore();
    const storage = createSecureStorage({ db });
    await storage.set('refreshToken', 'r-secret-123');
    expect(await storage.get('refreshToken')).toBe('r-secret-123');
    for (const v of db.raw.values())
      expect(
        JSON.stringify(v, (_k, x: unknown) =>
          x instanceof Uint8Array || ArrayBuffer.isView(x) ? Array.from(x as Uint8Array) : x,
        ),
      ).not.toContain('r-secret-123');
    await storage.remove('refreshToken');
    expect(await storage.get('refreshToken')).toBeNull();
  });
  it('keeps the key non-extractable and survives a second instance over the same store', async () => {
    const db = memoryStore();
    await createSecureStorage({ db }).set('a', '1');
    const key = db.raw.get('secure:key') as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(await createSecureStorage({ db }).get('a')).toBe('1');
  });
  it('clear removes every secure entry', async () => {
    const db = memoryStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.clear();
    expect([await storage.get('a'), await storage.get('b')]).toEqual([null, null]);
  });
});

type Sealed = { iv: Uint8Array; data: Uint8Array };

describe('secure storage: the key and the sealed entries', () => {
  it('seals each value with a fresh 12-byte IV: the same text never looks the same', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', 'same');
    const first = db.raw.get('secure:a') as Sealed;
    await storage.set('a', 'same');
    const second = db.raw.get('secure:a') as Sealed;
    expect(Object.keys(first).sort()).toEqual(['data', 'iv']);
    expect(first.iv).toHaveLength(12);
    expect([...second.iv]).not.toEqual([...first.iv]);
    expect([...second.data]).not.toEqual([...first.data]);
    expect(await storage.get('a')).toBe('same');
  });

  it('binds each value to its name: moved, it reads as null and is removed', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', 'r-secret');
    db.raw.set('secure:b', db.raw.get('secure:a'));
    expect(await storage.get('b')).toBeNull();
    expect(db.raw.has('secure:b')).toBe(false);
    expect(await storage.get('a')).toBe('r-secret');
  });

  it('reads a value sealed under a lost key as null, and removes it', async () => {
    const db = memoryKvStore();
    const keyStore = memoryKvStore();
    await createSecureStorage({ db, keyStore }).set('a', '1');
    expect(keyStore.raw.get('secure:key')).toBeInstanceOf(CryptoKey);
    expect(db.raw.has('secure:key')).toBe(false);
    const afterKeyLoss = createSecureStorage({ db, keyStore: memoryKvStore() });
    expect(await afterKeyLoss.get('a')).toBeNull();
    expect(db.raw.has('secure:a')).toBe(false);
  });

  it('reads a tampered or malformed entry as null, and removes it', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', '1');
    const sealed = db.raw.get('secure:a') as Sealed;
    sealed.data[0] = (sealed.data[0] ?? 0) ^ 0xff;
    expect(await storage.get('a')).toBeNull();
    expect(db.raw.has('secure:a')).toBe(false);
    db.raw.set('secure:b', 'not a sealed entry');
    expect(await storage.get('b')).toBeNull();
    expect(db.raw.has('secure:b')).toBe(false);
  });

  it('fails a call whose key cannot be read, keeps the value and retries the key', async () => {
    const db = memoryKvStore();
    await createSecureStorage({ db }).set('a', '1');
    let unreadable = true;
    const keyStore: KvStore = {
      ...db,
      get: (k) => (unreadable ? Promise.reject(new Error('disk error')) : db.get(k)),
    };
    const storage = createSecureStorage({ db, keyStore });
    await expect(storage.get('a')).rejects.toThrow('disk error');
    expect(db.raw.has('secure:a')).toBe(true);
    unreadable = false;
    expect(await storage.get('a')).toBe('1');
  });

  it('generates one key, even when the first calls start together', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await Promise.all([storage.set('a', '1'), storage.set('b', '2')]);
    const again = createSecureStorage({ db });
    expect([await again.get('a'), await again.get('b')]).toEqual(['1', '2']);
  });

  it('keeps one key when two instances first use the store at the same time', async () => {
    const db = memoryKvStore();
    const first = createSecureStorage({ db });
    const second = createSecureStorage({ db });
    await Promise.all([first.set('a', '1'), second.set('b', '2')]);
    const again = createSecureStorage({ db });
    expect([await again.get('a'), await again.get('b')]).toEqual(['1', '2']);
    expect([await first.get('b'), await second.get('a')]).toEqual(['2', '1']);
  });

  it('adopts a key stored after its own instead of removing what that key sealed', async () => {
    const db = memoryKvStore();
    const first = createSecureStorage({ db });
    await first.set('a', '1');
    db.raw.delete('secure:key'); // the key is lost, and another instance stores a new one
    await createSecureStorage({ db }).set('b', '2');
    expect(await first.get('b')).toBe('2');
    expect(db.raw.has('secure:b')).toBe(true);
    await first.set('c', '3'); // sealed under the adopted key from now on
    expect(await createSecureStorage({ db }).get('c')).toBe('3');
  });

  it('runs its calls in call order: a clear is never overtaken by a set in flight', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await Promise.all([storage.set('a', '1'), storage.clear()]);
    expect(await storage.get('a')).toBeNull();
    expect([...db.raw.keys()]).toEqual(['secure:key']);
    await Promise.all([storage.set('b', '2'), storage.remove('b'), storage.set('c', '3')]);
    expect([await storage.get('b'), await storage.get('c')]).toEqual([null, '3']);
  });

  it('clear keeps the key and entries that are not its own', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', '1');
    const key = db.raw.get('secure:key');
    db.raw.set('app.other', 'x');
    await storage.clear();
    expect([...db.raw.keys()].sort()).toEqual(['app.other', 'secure:key']);
    expect(db.raw.get('secure:key')).toBe(key);
    await storage.set('b', '2');
    expect(await createSecureStorage({ db }).get('b')).toBe('2');
  });

  it('refuses the name its own key is kept under', async () => {
    const db = memoryKvStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', '1');
    const key = db.raw.get('secure:key');
    await expect(storage.set('key', 'x')).rejects.toThrow('reserved');
    await expect(storage.get('key')).rejects.toThrow('reserved');
    await expect(storage.remove('key')).rejects.toThrow('reserved');
    expect(db.raw.get('secure:key')).toBe(key);
    expect(await storage.get('a')).toBe('1');
  });

  it('keeps its key and values in IndexedDB by default (investor-app / secure)', async () => {
    await createSecureStorage().set('refreshToken', 'r-1');
    const store = createStore('investor-app', 'secure');
    const key: unknown = await get('secure:key', store);
    expect(key).toBeInstanceOf(CryptoKey);
    const { extractable, algorithm, usages } = key as CryptoKey;
    expect(extractable).toBe(false);
    expect(algorithm.name).toBe('AES-GCM');
    expect((algorithm as AesKeyAlgorithm).length).toBe(256);
    expect([...usages].sort()).toEqual(['decrypt', 'encrypt']);
    const sealed = await get<Sealed>('secure:refreshToken', store);
    expect(sealed?.iv).toHaveLength(12);
    expect(await createSecureStorage().get('refreshToken')).toBe('r-1');
  });

  it('keeps one key in IndexedDB when two instances first use it at the same time', async () => {
    await clear(createStore('investor-app', 'secure'));
    const [first, second] = [createSecureStorage(), createSecureStorage()];
    await Promise.all([first.set('a', '1'), second.set('b', '2')]);
    const again = createSecureStorage();
    expect([await again.get('a'), await again.get('b')]).toEqual(['1', '2']);
  });
});

describe('secure storage: the call queue', () => {
  it('lets a call that nobody waits for reject unhandled', async () => {
    const db: KvStore = { ...memoryKvStore(), set: () => Promise.reject(new Error('disk full')) };
    const storage = createSecureStorage({ db });
    const unhandled: unknown[] = [];
    const collect = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', collect); // Vitest leaves a rejection with a listener to it
    try {
      void storage.set('a', '1');
      await vi.waitFor(() => expect(unhandled).toHaveLength(1));
    } finally {
      process.off('unhandledRejection', collect);
    }
    expect(unhandled[0]).toEqual(new Error('disk full'));
  });

  it('goes on with the calls after one that failed', async () => {
    const memory = memoryKvStore();
    let full = true;
    const db: KvStore = {
      ...memory,
      set: (key, value) => (full ? Promise.reject(new Error('disk full')) : memory.set(key, value)),
    };
    const storage = createSecureStorage({ db });
    const failed = storage.set('a', '1');
    const next = storage.get('a');
    await expect(failed).rejects.toThrow('disk full');
    expect(await next).toBeNull();
    full = false;
    await storage.set('b', '2');
    expect(await storage.get('b')).toBe('2');
  });
});
