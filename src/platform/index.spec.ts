import { describe, it, expect, vi, afterEach } from 'vitest';
import { base64url } from '../lib/base64url';

const vapidKey =
  'BPhdfj-y8kOzT3Sd9yXMbWcQ4T1jg0tQmxNCDsB6cYbm3wLsgT4eUKL6vK9Qh0z7u6MkW6iSsO5l1YV7Jq6fCnM';

/** A fresh copy of the platform, built for the browser the test has set up. */
async function freshPlatform() {
  vi.resetModules();
  return (await import('./index')).platform;
}

/** A service worker container; `ready` never settles, as without a worker it never does. */
function serviceWorkerContainer(getRegistration: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration, ready: new Promise(() => {}) },
  });
}

describe('the web platform', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.unstubAllGlobals();
  });

  it('reports push as unsupported where there is no service worker container', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const platform = await freshPlatform();
    expect(platform.kind).toBe('web');
    expect(platform.notifications.permission()).toBe('unsupported');
  });

  it('never waits for a service worker that is not registered', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('PushManager', class PushManager {});
    serviceWorkerContainer(() => Promise.resolve(undefined));
    const { notifications } = await freshPlatform();
    expect(notifications.permission()).toBe('granted');
    await expect(notifications.subscribe(vapidKey)).rejects.toThrow(
      'No service worker is registered.',
    );
    await expect(notifications.show({ title: 'Deposit received' })).rejects.toThrow(
      'No service worker is registered.',
    );
    expect(await notifications.unsubscribe()).toBeNull();
  });

  it('passes on a failure to look the service worker up', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('PushManager', class PushManager {});
    const failure = new DOMException('The document is in an invalid state.', 'InvalidStateError');
    serviceWorkerContainer(() => Promise.reject(failure));
    const { notifications } = await freshPlatform();
    await expect(notifications.unsubscribe()).rejects.toBe(failure);
    await expect(notifications.subscribe(vapidKey)).rejects.toBe(failure);
    await expect(notifications.show({ title: 'Deposit received' })).rejects.toBe(failure);
  });

  it('shows notifications through the registered service worker', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const showNotification = vi.fn(() => Promise.resolve());
    serviceWorkerContainer(() => Promise.resolve({ showNotification }));
    const { notifications } = await freshPlatform();
    await notifications.show({ title: 'Deposit received' });
    expect(showNotification).toHaveBeenCalledWith('Deposit received', {
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
    });
  });
});

const SAFARI_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** Gives navigator what a browser has; afterEach takes it away again. */
function browser(values: Record<string, unknown>) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(navigator, name, { configurable: true, value });
  }
}

/** A platform authenticator with an RS256 key that signs for this page: jsdom's localhost:3000. */
async function authenticator() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const create = vi.fn<(options: { publicKey: { rp: { id: string } } }) => Promise<unknown>>(() =>
    Promise.resolve({
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: { getPublicKey: () => spki, getPublicKeyAlgorithm: () => -257 },
    }),
  );
  const get = vi.fn(async (options: { publicKey: { challenge: Uint8Array } }) => {
    const rpIdHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('localhost'));
    const authenticatorData = new Uint8Array([...new Uint8Array(rpIdHash), 0x05, 0, 0, 0, 0]);
    const clientData = {
      type: 'webauthn.get',
      challenge: base64url.encode(options.publicKey.challenge),
      origin: 'http://localhost:3000',
    };
    const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData)).slice();
    const clientHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signed = new Uint8Array([...authenticatorData, ...new Uint8Array(clientHash)]);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signed);
    return {
      response: {
        authenticatorData: authenticatorData.buffer,
        clientDataJSON: clientDataJSON.buffer,
        signature,
      },
    };
  });
  return { create, get, credentials: { create, get } };
}

describe('the web platform: the adapters it wires', () => {
  afterEach(() => {
    for (const name of ['vibrate', 'canShare', 'share', 'userAgent', 'platform', 'credentials']) {
      delete (navigator as unknown as Record<string, unknown>)[name];
    }
    vi.unstubAllGlobals();
  });

  it("vibrates, shares and gives Safari's install hint through the browser", async () => {
    const vibrate = vi.fn(() => true);
    const share = vi.fn(() => Promise.resolve());
    browser({
      vibrate,
      canShare: () => true,
      share,
      userAgent: SAFARI_ON_MAC,
      platform: 'MacIntel',
    });
    const platform = await freshPlatform();
    platform.haptics.success();
    expect(vibrate).toHaveBeenCalledWith([10, 40, 10]);
    expect(platform.install.hint()).toBe('safari-mac');
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
    expect(await platform.share.files([file], 'Statement')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'Statement' });
  });

  it('builds the lock for this page and its storage: host name as rpId, and origin', async () => {
    const auth = await authenticator();
    browser({ credentials: auth.credentials });
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    });
    vi.stubGlobal('AuthenticatorAttestationResponse', { prototype: { getPublicKey: () => null } });
    const { lock, storage } = await freshPlatform();
    expect(await lock.available()).toBe('webauthn');
    await lock.enrollWebAuthn({ id: 'u1', email: 'ada@example.com' });
    expect(auth.create.mock.calls[0]![0].publicKey.rp.id).toBe('localhost'); // not localhost:3000
    expect(await lock.verify()).toBe(true); // signed for the origin, not the page address (href)
    expect(await storage.get('lock:webauthn')).not.toBeNull();
    await storage.reset();
  });
});
