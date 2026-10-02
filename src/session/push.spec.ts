// Web push through the session: the subscription handed to the platform once a session opens
// signed in, and taken back at the investor's own sign-out (src/session/push.ts, wired into the
// session controller). Driven without React, over the sample world and the fake platform.

import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveApi } from '../api/createLiveApi';
import { createSampleApi, type SampleApi } from '../api/createSampleApi';
import type { PushSubscriptionInput } from '../api/types';
import type { NotificationsAdapter, Platform } from '../platform/types';
import { createQueryClient } from '../queries/client';
import { fakePlatform } from '../test/fakePlatform';
import { liveApi } from '../test/liveApi';
import { createSessionController, type ApiWiring } from './sessionController';
import { createTokenStore } from './tokens';

const pairOf = (n: number) => ({
  tokenType: 'Bearer' as const,
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  accessExpiresAt: '2026-10-01T12:15:00.000Z',
  refreshExpiresAt: '2026-10-31T12:00:00.000Z',
});

const SUBSCRIPTION: PushSubscriptionInput = {
  endpoint: 'https://push.example/send/abc',
  keys: { p256dh: 'BP256dh', auth: 'auth-secret' },
  platform: 'web',
};

/** The browser's push, as the fake platform gives it: allowed, and a subscription to hand over. */
function pushDevice(notifications: Partial<NotificationsAdapter> = {}, more = {}) {
  const subscribe = vi.fn((key: string) => {
    void key;
    return Promise.resolve(SUBSCRIPTION);
  });
  const unsubscribe = vi.fn(() => Promise.resolve(SUBSCRIPTION.endpoint as string | null));
  const request = vi.fn(() => Promise.resolve('granted' as const));
  const device = fakePlatform({
    notifications: {
      permission: () => 'granted',
      subscribe,
      unsubscribe,
      request,
      ...notifications,
    },
    ...more,
  });
  return { device, subscribe, unsubscribe, request };
}

// The tabs a test opened, stopped after it.
const stops: (() => void)[] = [];

/** A tab of the app on `device` over a fresh sample world; the worker is active unless told. */
function openTab(device: Platform, workerReady = vi.fn(() => Promise.resolve(true))) {
  const api: SampleApi = createSampleApi({
    latencyMs: 0,
    onSignedOut: (reason) => wired?.events.onSignedOut(reason),
  });
  let wired: ApiWiring | undefined;
  const queryClient = createQueryClient();
  const session = createSessionController({
    makeApi: (wiring) => {
      wired = wiring;
      return api;
    },
    platform: device,
    queryClient,
    tokenStore: createTokenStore(device.storage),
    appVersion: '1.0.0',
    workerReady,
  });
  stops.push(session.start());
  const spies = {
    pushSubscribe: vi.spyOn(api, 'pushSubscribe'),
    pushUnsubscribe: vi.spyOn(api, 'pushUnsubscribe'),
    logout: vi.spyOn(api, 'logout'),
  };
  return {
    session,
    api,
    workerReady,
    ...spies,
    status: () => session.getSnapshot().status,
    /** The platform ends the session, as its client tells the session. */
    revoked: () => wired?.events.onSignedOut('session_revoked'),
  };
}

/** Signs in to the sample world and declines the lock it offers. */
async function signIn(tab: ReturnType<typeof openTab>) {
  await waitFor(() => expect(tab.status()).toBe('signed-out'));
  await tab.session.enterSample();
  tab.session.skipLockSetup();
  expect(tab.status()).toBe('signed-in');
}

/** Lets every step under way run (the sample world answers on a zero timeout). */
const settle = () => vi.advanceTimersByTimeAsync(50);

describe('push, once a session opens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
  });

  it('subscribes for the brand’s key and tells the platform after a sign-in', async () => {
    const { device, subscribe, request } = pushDevice();
    const tab = openTab(device);
    await signIn(tab);
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledWith(SUBSCRIPTION));
    const { vapidPublicKey } = await tab.api.brand();
    expect(vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(subscribe).toHaveBeenCalledWith(vapidPublicKey);
    expect(tab.workerReady).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled(); // permission is asked for in Profile only
  });

  it('does nothing where the browser has no push', async () => {
    const device = fakePlatform(); // its notifications answer 'unsupported'
    const subscribe = vi.spyOn(device.notifications, 'subscribe');
    const tab = openTab(device);
    await signIn(tab);
    await settle();
    expect(subscribe).not.toHaveBeenCalled();
    expect(tab.pushSubscribe).not.toHaveBeenCalled();
  });

  it.each(['default', 'denied'] as const)(
    'asks nothing and subscribes nothing while the permission is %s',
    async (permission) => {
      const { device, subscribe, request } = pushDevice({ permission: () => permission });
      const tab = openTab(device);
      await signIn(tab);
      await settle();
      expect(request).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      expect(tab.pushSubscribe).not.toHaveBeenCalled();
    },
  );

  it('does nothing when the company’s brand names no push key', async () => {
    const { device, subscribe } = pushDevice();
    const tab = openTab(device);
    const { vapidPublicKey, ...withoutKey } = await tab.api.brand();
    expect(vapidPublicKey).toBeDefined();
    vi.spyOn(tab.api, 'brand').mockResolvedValue(withoutKey);
    await signIn(tab);
    await settle();
    expect(subscribe).not.toHaveBeenCalled();
    expect(tab.pushSubscribe).not.toHaveBeenCalled();
  });

  it('does nothing when the service worker is not active in time', async () => {
    const { device, subscribe } = pushDevice();
    const tab = openTab(
      device,
      vi.fn(() => Promise.resolve(false)),
    );
    await signIn(tab);
    await settle();
    expect(tab.workerReady).toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(tab.pushSubscribe).not.toHaveBeenCalled();
  });

  it('reports a subscription that fails, and tells the investor nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new DOMException('Registration failed - push service error', 'AbortError');
    const { device } = pushDevice({ subscribe: () => Promise.reject(failure) });
    const tab = openTab(device);
    await signIn(tab);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[investor-app] turning on push:', failure),
    );
    expect(tab.pushSubscribe).not.toHaveBeenCalled();
    expect(tab.session.getSnapshot().notice).toBeNull();
    expect(tab.status()).toBe('signed-in');
  });

  it('reports a subscription the platform refuses, and tells the investor nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { device } = pushDevice();
    const tab = openTab(device);
    const failure = new Error('push/subscribe refused');
    tab.pushSubscribe.mockRejectedValue(failure);
    await signIn(tab);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[investor-app] turning on push:', failure),
    );
    expect(tab.session.getSnapshot().notice).toBeNull();
    // Nothing was registered, so the sign-out has nothing to take back at the platform.
    await tab.session.signOut();
    expect(tab.pushUnsubscribe).not.toHaveBeenCalled();
  });

  it('subscribes after a launch that opens signed in', async () => {
    sessionStorage.setItem('app.sample', '1'); // a sample session from before the reload
    const { device } = pushDevice({}, { lock: { enrolled: () => Promise.resolve(null) } });
    const tab = openTab(device);
    await waitFor(() => expect(tab.status()).toBe('signed-in'));
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledWith(SUBSCRIPTION));
  });

  it('subscribes once the lock a launch opened on is unlocked, and once only', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload, with a lock
    const { device, subscribe } = pushDevice();
    const tab = openTab(device);
    await waitFor(() => expect(tab.status()).toBe('locked'));
    await settle();
    expect(subscribe).not.toHaveBeenCalled(); // nothing while the investor has not unlocked
    await tab.session.unlock();
    expect(tab.status()).toBe('signed-in');
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledTimes(1));
    tab.session.lock(); // "Lock now", and unlocked again: the same session, already subscribed
    await waitFor(() => expect(tab.status()).toBe('locked'));
    await tab.session.unlock();
    await settle();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(tab.pushSubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes again for the next session of the same visit', async () => {
    const { device } = pushDevice();
    const tab = openTab(device);
    await signIn(tab);
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledTimes(1));
    await tab.session.signOut();
    await tab.session.enterSample();
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledTimes(2));
  });
});

describe('push, at the end of a session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
  });

  /** A tab signed in with push on: the platform has this browser's subscription. */
  async function subscribedTab(device = pushDevice()) {
    const tab = openTab(device.device);
    await signIn(tab);
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledWith(SUBSCRIPTION));
    return { ...tab, unsubscribe: device.unsubscribe };
  }

  it('tells the platform push ends before it signs out, then ends it here', async () => {
    const tab = await subscribedTab();
    await tab.session.signOut();
    expect(tab.status()).toBe('signed-out');
    expect(tab.pushUnsubscribe).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
    expect(tab.logout).toHaveBeenCalledTimes(1);
    const [told] = tab.pushUnsubscribe.mock.invocationCallOrder;
    const [loggedOut] = tab.logout.mock.invocationCallOrder;
    const [ended] = tab.unsubscribe.mock.invocationCallOrder;
    expect(told).toBeLessThan(loggedOut ?? 0); // while the session can still say so
    expect(loggedOut).toBeLessThan(ended ?? 0); // the browser's subscription ends here after
  });

  it('waits three seconds at most for the platform to hear of it', async () => {
    const tab = await subscribedTab();
    tab.pushUnsubscribe.mockReturnValue(new Promise<void>(() => {}));
    const leaving = tab.session.signOut();
    await vi.advanceTimersByTimeAsync(2_900);
    expect(tab.logout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await leaving;
    expect(tab.logout).toHaveBeenCalledTimes(1);
    expect(tab.status()).toBe('signed-out');
  });

  it('signs out all the same when the platform refuses, and reports it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tab = await subscribedTab();
    const failure = new Error('push/unsubscribe refused');
    tab.pushUnsubscribe.mockRejectedValue(failure);
    await tab.session.signOut();
    expect(warn).toHaveBeenCalledWith(
      '[investor-app] signing out: telling the platform push ends:',
      failure,
    );
    expect(tab.logout).toHaveBeenCalledTimes(1);
    expect(tab.status()).toBe('signed-out');
  });

  it('tells the platform nothing of push where no subscription was handed over', async () => {
    const tab = openTab(fakePlatform()); // no push in this browser
    await signIn(tab);
    await tab.session.signOut();
    expect(tab.pushUnsubscribe).not.toHaveBeenCalled();
    expect(tab.logout).toHaveBeenCalledTimes(1);
  });

  it('tells the platform nothing when it ended the session itself', async () => {
    const tab = await subscribedTab();
    tab.revoked();
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    expect(tab.pushUnsubscribe).not.toHaveBeenCalled(); // it drops a revoked session's own
    expect(tab.unsubscribe).toHaveBeenCalledTimes(1); // and this browser's ends all the same
  });

  it('never keeps a subscription handed over for a session that has ended since', async () => {
    let permission: 'granted' | 'denied' = 'granted';
    const { device } = pushDevice({ permission: () => permission });
    const tab = openTab(device);
    let answer!: () => void;
    tab.pushSubscribe.mockImplementationOnce(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    await signIn(tab);
    await waitFor(() => expect(tab.pushSubscribe).toHaveBeenCalledTimes(1));
    tab.revoked(); // the platform ends the session while it hears of the subscription
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    answer();
    await settle();
    permission = 'denied'; // the next session has no push of its own
    await tab.session.enterSample();
    await tab.session.signOut();
    expect(tab.pushUnsubscribe).not.toHaveBeenCalled();
  });

  it('forgets what it handed over once the platform has ended the session', async () => {
    let permission: 'granted' | 'denied' = 'granted';
    const tab = await subscribedTab(pushDevice({ permission: () => permission }));
    tab.revoked();
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    permission = 'denied'; // the next session has no push of its own
    await tab.session.enterSample();
    await tab.session.signOut();
    expect(tab.pushUnsubscribe).not.toHaveBeenCalled();
  });

  it('forgets what it handed over once it follows another tab’s sign-in', async () => {
    let permission: 'granted' | 'denied' = 'granted';
    const { device } = pushDevice({ permission: () => permission });
    const ok = () =>
      Promise.resolve(
        new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
      );
    let api: LiveApi | undefined;
    const queryClient = createQueryClient();
    const session = createSessionController({
      makeApi: (wiring) => {
        api = liveApi({ answer: (path) => (path.startsWith('/push/') ? ok() : undefined) })(wiring);
        return api;
      },
      platform: device,
      queryClient,
      tokenStore: createTokenStore(device.storage),
      appVersion: '1.0.0',
      workerReady: () => Promise.resolve(true),
    });
    stops.push(session.start());
    if (api === undefined) throw new Error('The session made no api.');
    const pushSubscribe = vi.spyOn(api, 'pushSubscribe');
    const pushUnsubscribe = vi.spyOn(api, 'pushUnsubscribe');
    await waitFor(() => expect(session.getSnapshot().status).toBe('signed-out'));
    await session.signIn(pairOf(1));
    await waitFor(() => expect(pushSubscribe).toHaveBeenCalledWith(SUBSCRIPTION));
    permission = 'denied'; // the session it follows has no push of its own
    const otherTab = createTokenStore(device.storage);
    stops.push(otherTab.subscribe(() => {}));
    await otherTab.start(pairOf(2)); // someone signs in on another tab; this one follows
    await waitFor(() => expect(session.getSnapshot().status).toBe('signed-in'));
    await settle();
    await session.signOut();
    expect(pushUnsubscribe).not.toHaveBeenCalled();
  });
});
