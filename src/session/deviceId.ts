// X-Device-Id: random per install, kept in localStorage (`app.deviceId`) so the platform lists one
// session per browser. It names this install only; it is not a secret and not investor data.

import { base64url } from '../lib/base64url';
import { reportProblem } from '../lib/report';

const KEY = 'app.deviceId';
/** What the platform takes as a device id (CLAUDE.md); anything else it treats as none. */
const VALID = /^[A-Za-z0-9_-]{8,128}$/;

/** For a page whose storage is blocked: one id for as long as the page lives. */
let unstored: string | undefined;

/** 24 random bytes as 32 base64url characters. */
function newDeviceId(): string {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(24)));
}

/**
 * This install's device id: the stored one, else a new one stored for next time (a stored value
 * the platform would refuse is replaced). Where storage is blocked, the same id for the page.
 */
export function getDeviceId(storage?: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const store = storage ?? window.localStorage;
    const stored = store.getItem(KEY);
    if (stored !== null && VALID.test(stored)) return stored;
    const id = newDeviceId();
    store.setItem(KEY, id);
    return id;
  } catch (error) {
    if (unstored === undefined) reportProblem('keeping the device id', error);
    unstored ??= newDeviceId();
    return unstored;
  }
}

/**
 * The user handle of this install's device credentials (src/platform/types.ts, enrollWebAuthn):
 * the SHA-256 of its device id, 32 bytes, the same every time, so a new credential replaces the
 * last. It names the install only, like the id it comes from.
 */
export async function deviceHandle(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const id = new TextEncoder().encode(getDeviceId(storage));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', id));
}
