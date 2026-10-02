import { describe, expect, it, vi } from 'vitest';
import { getDeviceId } from './deviceId';

/** A Storage stand-in: `failing` makes every call throw, as a blocked localStorage does. */
function store(initial: Record<string, string> = {}, failing = false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      if (failing) throw new DOMException('blocked', 'SecurityError');
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failing) throw new DOMException('blocked', 'SecurityError');
      values.set(key, value);
    },
  };
}

const PLATFORM_ID = /^[A-Za-z0-9_-]{8,128}$/;

describe('getDeviceId', () => {
  it('keeps the id this install already has', () => {
    expect(getDeviceId(store({ 'app.deviceId': 'install_1-abcdef' }))).toBe('install_1-abcdef');
  });

  it('gives a new install 32 random base64url characters, stored for next time', () => {
    const first = store();
    const id = getDeviceId(first);
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.values.get('app.deviceId')).toBe(id);
    expect(getDeviceId(first)).toBe(id);
    expect(getDeviceId(store())).not.toBe(id);
  });

  it('replaces a stored id the platform would refuse', () => {
    for (const bad of ['short', 'has spaces in it', 'x'.repeat(129), 'ünïcödé-id']) {
      const s = store({ 'app.deviceId': bad });
      const id = getDeviceId(s);
      expect(id).not.toBe(bad);
      expect(id).toMatch(PLATFORM_ID);
      expect(s.values.get('app.deviceId')).toBe(id);
    }
  });

  it('keeps one id for the page when storage is blocked, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = store({}, true);
    const id = getDeviceId(blocked);
    expect(id).toMatch(PLATFORM_ID);
    expect(getDeviceId(blocked)).toBe(id);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[investor-app] keeping the device id:',
      expect.any(DOMException),
    );
    warn.mockRestore();
  });
});
