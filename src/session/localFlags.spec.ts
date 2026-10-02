import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockPreference, sampleFlag } from './localFlags';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('lockPreference', () => {
  it('is unset until the investor decides, then on or off', () => {
    expect(lockPreference.read()).toBeNull();
    expect(lockPreference.write(true)).toBe(true); // saved
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
    expect(lockPreference.read()).toBe(true);
    lockPreference.write(false);
    expect(lockPreference.read()).toBe(false);
    lockPreference.clear();
    expect(lockPreference.read()).toBeNull();
  });

  it('reads anything else as unset', () => {
    localStorage.setItem('app.lockEnabled', 'maybe');
    expect(lockPreference.read()).toBeNull();
  });

  it('knows the storage events of another tab that may have changed it', () => {
    const event = (key: string | null) => new StorageEvent('storage', { key });
    expect(lockPreference.changedBy(event('app.lockEnabled'))).toBe(true);
    expect(lockPreference.changedBy(event(null))).toBe(true); // that tab cleared the storage
    expect(lockPreference.changedBy(event('app.theme'))).toBe(false);
  });
});

describe('sampleFlag', () => {
  it('marks a sample session for this tab only', () => {
    expect(sampleFlag.read()).toBe(false);
    sampleFlag.write();
    expect(sessionStorage.getItem('app.sample')).toBe('1');
    expect(localStorage.getItem('app.sample')).toBeNull();
    expect(sampleFlag.read()).toBe(true);
    sampleFlag.clear();
    expect(sampleFlag.read()).toBe(false);
  });
});

describe('when storage is blocked', () => {
  it('reads nothing and writes nothing, without throwing, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    }
    expect(lockPreference.write(true)).toBe(false); // not saved, and no throw
    expect(() => lockPreference.clear()).not.toThrow();
    expect(lockPreference.read()).toBeNull();
    expect(() => sampleFlag.write()).not.toThrow();
    expect(() => sampleFlag.clear()).not.toThrow();
    expect(sampleFlag.read()).toBe(false);
    expect(warn.mock.calls.map(([where]) => where as string)).toEqual([
      '[investor-app] saving the lock setting:',
      '[investor-app] clearing the lock setting:',
      '[investor-app] reading the lock setting:',
      '[investor-app] saving the sample flag:',
      '[investor-app] clearing the sample flag:',
      '[investor-app] reading the sample flag:',
    ]);
  });
});
