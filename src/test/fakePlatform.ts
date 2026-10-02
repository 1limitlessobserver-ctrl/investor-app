import type { LockMethod, Platform } from '../platform/types';

/** Per adapter, the methods to replace: `{ lock: { enrolled: () => Promise.resolve(null) } }`. */
export type PlatformOverrides = { [K in Exclude<keyof Platform, 'kind'>]?: Partial<Platform[K]> };

/**
 * A platform for specs: secure storage over a Map, and a device lock already set up with the
 * device's own prompt, which always verifies (so `confirm()` and `unlock()` pass with a tap).
 * Enrolling sets the lock up and clear() forgets it, as on a device; the passcode is 246810.
 * Notifications, sharing and installing do nothing.
 */
export function fakePlatform(overrides: PlatformOverrides = {}): Platform {
  const values = new Map<string, string>();
  let enrolled: LockMethod | null = 'webauthn';
  return {
    kind: 'web',
    storage: {
      get: (key) => Promise.resolve(values.get(key) ?? null),
      set: (key, value) => {
        values.set(key, value);
        return Promise.resolve();
      },
      remove: (key) => {
        values.delete(key);
        return Promise.resolve();
      },
      clear: () => {
        values.clear();
        return Promise.resolve();
      },
      reset: () => {
        values.clear();
        return Promise.resolve();
      },
      ...overrides.storage,
    },
    lock: {
      available: () => Promise.resolve('webauthn'),
      enrolled: () => Promise.resolve(enrolled),
      enrollWebAuthn: () => {
        enrolled = 'webauthn';
        return Promise.resolve();
      },
      enrollPasscode: () => {
        enrolled = 'passcode';
        return Promise.resolve();
      },
      verify: () => Promise.resolve(true),
      verifyPasscode: (code) => Promise.resolve({ ok: code === '246810', attemptsLeft: 5 }),
      clear: () => {
        enrolled = null;
        return Promise.resolve();
      },
      ...overrides.lock,
    },
    notifications: {
      permission: () => 'unsupported',
      request: () => Promise.resolve('unsupported'),
      subscribe: () => Promise.reject(new Error('unsupported')),
      unsubscribe: () => Promise.resolve(null),
      show: () => Promise.resolve(),
      ...overrides.notifications,
    },
    share: { files: () => Promise.resolve('downloaded'), ...overrides.share },
    install: {
      canPrompt: () => false,
      prompt: () => Promise.resolve('unavailable'),
      isInstalled: () => false,
      hint: () => null,
      subscribe: () => () => {},
      ...overrides.install,
    },
    haptics: { tick() {}, success() {}, warn() {}, ...overrides.haptics },
  };
}
