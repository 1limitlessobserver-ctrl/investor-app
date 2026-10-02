import type { KvStore } from '../platform/web/storage';

/**
 * A KvStore over a Map, for specs: `raw` is the Map itself, to read or change what is stored. As
 * in IndexedDB, update() runs its updater on the stored value in one step, and an updater that
 * throws stores nothing and rejects the call.
 */
export function memoryKvStore(): KvStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: (key) => Promise.resolve(raw.get(key)),
    set: (key, value) => {
      raw.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      raw.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...raw.keys()]),
    update: <T>(key: string, updater: (old: T | undefined) => T) =>
      new Promise<T>((resolve) => {
        const next = updater(raw.get(key) as T | undefined);
        raw.set(key, next);
        resolve(next);
      }),
  };
}
