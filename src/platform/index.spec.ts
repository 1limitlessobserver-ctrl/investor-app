import { describe, it, expect, vi, afterEach } from 'vitest';

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
