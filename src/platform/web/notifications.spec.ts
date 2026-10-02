import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebNotifications } from './notifications';

describe('web notifications', () => {
  it('subscribes with the VAPID key and returns the platform payload', async () => {
    const sub = {
      endpoint: 'https://push.example/abc',
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }),
      unsubscribe: vi.fn(() => Promise.resolve(true)),
    };
    const pushManager = {
      getSubscription: vi.fn(() => Promise.resolve(null)),
      subscribe: vi.fn<(options: unknown) => Promise<typeof sub>>(() => Promise.resolve(sub)),
    };
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted'),
    };
    const n = createWebNotifications({
      registration: () =>
        Promise.resolve({
          pushManager,
          showNotification: vi.fn(),
        } as unknown as ServiceWorkerRegistration),
    });
    const key =
      'BPhdfj-y8kOzT3Sd9yXMbWcQ4T1jg0tQmxNCDsB6cYbm3wLsgT4eUKL6vK9Qh0z7u6MkW6iSsO5l1YV7Jq6fCnM';
    const out = await n.subscribe(key);
    expect(out).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'P', auth: 'A' },
      platform: 'web',
    });
    const arg = pushManager.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(arg.userVisibleOnly).toBe(true);
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(arg.applicationServerKey.length).toBe(65);
    expect(await n.unsubscribe()).toBe('https://push.example/abc');
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
  it('reports unsupported without a service worker or Notification API', () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(createWebNotifications({ registration: undefined }).permission()).toBe('unsupported');
  });
});

const vapidKey =
  'BPhdfj-y8kOzT3Sd9yXMbWcQ4T1jg0tQmxNCDsB6cYbm3wLsgT4eUKL6vK9Qh0z7u6MkW6iSsO5l1YV7Jq6fCnM';

function subscription(json: object) {
  return {
    endpoint: 'https://push.example/abc',
    toJSON: () => json,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}
type FakeSubscription = ReturnType<typeof subscription>;

/** A service worker registration whose push manager holds `existing` and creates `created`. */
function fakeRegistration(existing: FakeSubscription | null, created?: FakeSubscription) {
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(existing)),
    subscribe: vi.fn(() => Promise.resolve(created)),
  };
  const showNotification = vi.fn(() => Promise.resolve());
  const registration = () =>
    Promise.resolve({ pushManager, showNotification } as unknown as ServiceWorkerRegistration);
  return { pushManager, showNotification, registration };
}

function notificationApi(permission: NotificationPermission, answer = permission) {
  const requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('Notification', { permission, requestPermission });
  return requestPermission;
}

describe('web notifications: permission, subscriptions and local notifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the browser's permission while push is supported", () => {
    const { registration } = fakeRegistration(null);
    for (const permission of ['default', 'granted', 'denied'] as const) {
      notificationApi(permission);
      expect(createWebNotifications({ registration }).permission()).toBe(permission);
    }
  });

  it('asks for permission, and counts a prompt closed without an answer as denied', async () => {
    const { registration } = fakeRegistration(null);
    const answers = [
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['default', 'denied'],
    ] as const;
    for (const [answer, expected] of answers) {
      const requestPermission = notificationApi('default', answer);
      expect(await createWebNotifications({ registration }).request()).toBe(expected);
      expect(requestPermission).toHaveBeenCalledTimes(1);
    }
  });

  it('is unsupported without a registration, even where the Notification API exists', async () => {
    const requestPermission = notificationApi('granted');
    for (const n of [
      createWebNotifications(),
      createWebNotifications({ registration: undefined }),
    ]) {
      expect(n.permission()).toBe('unsupported');
      expect(await n.request()).toBe('unsupported');
      await expect(n.subscribe(vapidKey)).rejects.toThrow('not supported');
      expect(await n.unsubscribe()).toBeNull();
      await expect(n.show({ title: 'Deposit received' })).rejects.toThrow('not supported');
    }
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('is unsupported without the Notification API, even with a registration', async () => {
    vi.stubGlobal('Notification', undefined);
    const n = createWebNotifications({ registration: fakeRegistration(null).registration });
    expect(n.permission()).toBe('unsupported');
    expect(await n.request()).toBe('unsupported');
  });

  it('reuses the subscription the browser already holds', async () => {
    const keys = { p256dh: 'P', auth: 'A' };
    const held = subscription({ endpoint: 'https://push.example/abc', keys });
    const { pushManager, registration } = fakeRegistration(held);
    expect(await createWebNotifications({ registration }).subscribe(vapidKey)).toEqual({
      endpoint: 'https://push.example/abc',
      keys,
      platform: 'web',
    });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('refuses a subscription that comes without its endpoint or keys', async () => {
    const incomplete = [
      { endpoint: 'https://push.example/abc' },
      { endpoint: 'https://push.example/abc', keys: { p256dh: 'P' } },
      { endpoint: 'https://push.example/abc', keys: { auth: 'A' } },
      { keys: { p256dh: 'P', auth: 'A' } },
    ];
    for (const json of incomplete) {
      const { registration } = fakeRegistration(null, subscription(json));
      await expect(
        createWebNotifications({ registration }).subscribe(vapidKey),
        JSON.stringify(json),
      ).rejects.toThrow(Error);
    }
  });

  it('answers null from unsubscribe, and passes the error on, without a worker', async () => {
    notificationApi('granted');
    const noWorker = () => Promise.reject(new Error('No service worker is registered.'));
    const n = createWebNotifications({ registration: noWorker });
    expect(await n.unsubscribe()).toBeNull();
    await expect(n.subscribe(vapidKey)).rejects.toThrow('No service worker is registered.');
    await expect(n.show({ title: 'Deposit received' })).rejects.toThrow(
      'No service worker is registered.',
    );
  });

  it('answers null when there is no subscription to end', async () => {
    const { registration } = fakeRegistration(null);
    expect(await createWebNotifications({ registration }).unsubscribe()).toBeNull();
  });

  it('ends the subscription the browser holds, even one made before this page loaded', async () => {
    const held = subscription({ endpoint: 'https://push.example/abc', keys: {} });
    const { registration } = fakeRegistration(held);
    expect(await createWebNotifications({ registration }).unsubscribe()).toBe(
      'https://push.example/abc',
    );
    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ends the subscription it made only once', async () => {
    const made = subscription({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'P', auth: 'A' },
    });
    const { registration } = fakeRegistration(null, made);
    const n = createWebNotifications({ registration });
    await n.subscribe(vapidKey);
    expect(await n.unsubscribe()).toBe('https://push.example/abc');
    expect(await n.unsubscribe()).toBeNull();
    expect(made.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('shows a notification with the app icon and badge', async () => {
    const { showNotification, registration } = fakeRegistration(null);
    const n = createWebNotifications({ registration });
    await n.show({ title: 'Deposit received', body: 'It is in your wallet.', tag: 'al_1' });
    await n.show({ title: 'Statement ready' });
    await n.show({ title: 'Statement ready', body: undefined, tag: undefined });
    expect(showNotification.mock.calls).toStrictEqual([
      [
        'Deposit received',
        {
          body: 'It is in your wallet.',
          tag: 'al_1',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
        },
      ],
      ['Statement ready', { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' }],
      ['Statement ready', { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' }],
    ]);
  });
});
