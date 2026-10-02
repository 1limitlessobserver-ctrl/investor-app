import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  onActivate,
  onMessage,
  onNotificationClick,
  onPush,
  type AppWindow,
  type WorkerScope,
} from './handlers';

/** A stand-in for the worker's global scope, with the app's open windows. */
function fakeScope(windows: AppWindow[] = []) {
  const scope = {
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn(() => Promise.resolve(null)),
      claim: vi.fn(() => Promise.resolve()),
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
  } satisfies WorkerScope;
  return scope;
}

/** A window of the app, its two calls watched. */
interface FakeWindow {
  navigate: Mock<(url: string) => Promise<AppWindow | null>>;
  focus: Mock<() => Promise<AppWindow>>;
}

/** A window of the app; `navigate` answers as the browser would for a window it controls. */
function fakeWindow(navigate?: (url: string) => Promise<AppWindow | null>): FakeWindow {
  const appWindow: FakeWindow = {
    navigate: vi.fn(navigate ?? (() => Promise.resolve(appWindow))),
    focus: vi.fn(() => Promise.resolve(appWindow)),
  };
  return appWindow;
}

/** An event's lifetime: what it was asked to wait for. */
function lifetime() {
  const waits: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => void waits.push(promise),
    waited: () => Promise.all(waits),
    waits,
  };
}

/** A push carrying `payload` as its JSON, or no data at all. */
function push(payload?: unknown) {
  const data = payload === undefined ? null : { json: () => payload };
  return { ...lifetime(), data };
}

/** A push whose payload is not JSON: reading it throws, as PushMessageData.json() does. */
function pushOfText(text: string) {
  return { ...lifetime(), data: { json: () => JSON.parse(text) as unknown } };
}

function click(data: unknown) {
  return { ...lifetime(), notification: { close: vi.fn(), data } };
}

describe('the service worker: a push', () => {
  it('shows its title with the app’s icon and badge, tagged and carrying its alert', async () => {
    const scope = fakeScope();
    const event = push({ notificationId: 'al_1', title: 'Your deposit arrived' });
    onPush(scope, event);
    await event.waited();
    expect(event.waits).toHaveLength(1);
    expect(scope.registration.showNotification).toHaveBeenCalledWith('Your deposit arrived', {
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: 'al_1',
      data: { notificationId: 'al_1' },
    });
    expect(NOTIFICATION_ICON).toBe('/icons/icon-192.png');
    expect(NOTIFICATION_BADGE).toBe('/icons/badge-96.png');
  });

  it('shows the title alone: nothing else a push carries reaches the notification', () => {
    const scope = fakeScope();
    onPush(scope, push({ notificationId: 'al_2', title: 'Funds unlocked', body: '$5,000.00' }));
    const [, options] = scope.registration.showNotification.mock.calls[0] as unknown as [
      string,
      NotificationOptions,
    ];
    expect(Object.keys(options).sort()).toEqual(['badge', 'data', 'icon', 'tag']);
  });

  it.each([
    ['carries no data', push()],
    ['is not JSON', pushOfText('not json')],
    ['names no alert and no title', push({})],
    ['carries something else than strings', push({ notificationId: 7, title: ['x'] })],
    ['carries a blank title', push({ title: '   ' })],
  ])('shows "New alert", untagged, when it %s', (_, event) => {
    const scope = fakeScope();
    onPush(scope, event);
    expect(scope.registration.showNotification).toHaveBeenCalledWith('New alert', {
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      data: { notificationId: null },
    });
  });
});

describe('the service worker: a notification’s tap', () => {
  it('closes it, and takes the open window to the alert it names', async () => {
    const appWindow = fakeWindow();
    const scope = fakeScope([appWindow]);
    const event = click({ notificationId: 'al_1' });
    onNotificationClick(scope, event);
    await event.waited();
    expect(event.notification.close).toHaveBeenCalledTimes(1);
    expect(scope.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(appWindow.navigate).toHaveBeenCalledWith('/alerts?open=al_1');
    expect(appWindow.focus).toHaveBeenCalledTimes(1);
    expect(appWindow.navigate.mock.invocationCallOrder[0]).toBeLessThan(
      appWindow.focus.mock.invocationCallOrder[0] ?? 0,
    );
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window at the alert when none of the app is open', async () => {
    const scope = fakeScope();
    const event = click({ notificationId: 'al 1&2' });
    onNotificationClick(scope, event);
    await event.waited();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/alerts?open=al%201%262');
  });

  it('opens the alerts when the notification names none', async () => {
    const scope = fakeScope();
    const event = click(undefined);
    onNotificationClick(scope, event);
    await event.waited();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/alerts');
  });

  it('opens a new window when the open one cannot be taken there', async () => {
    // A window this worker does not control (it opened before the worker took over) refuses.
    const appWindow = fakeWindow(() => Promise.reject(new TypeError('not controlled')));
    const scope = fakeScope([appWindow]);
    const event = click({ notificationId: 'al_1' });
    onNotificationClick(scope, event);
    await event.waited();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/alerts?open=al_1');
  });

  it('brings the window forward even when the browser does not say where it went', async () => {
    const appWindow = fakeWindow(() => Promise.resolve(null));
    const scope = fakeScope([appWindow]);
    const event = click({ notificationId: 'al_1' });
    onNotificationClick(scope, event);
    await event.waited();
    expect(appWindow.focus).toHaveBeenCalledTimes(1);
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });
});

describe('the service worker: a message from the app', () => {
  it('takes over at once when the app asks it to (the investor chose Reload)', () => {
    const scope = fakeScope();
    onMessage(scope, { data: { type: 'SKIP_WAITING' } });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it.each([[{ type: 'SOMETHING_ELSE' }], ['SKIP_WAITING'], [null], [undefined]])(
    'does nothing for %j',
    (data) => {
      const scope = fakeScope();
      onMessage(scope, { data });
      expect(scope.skipWaiting).not.toHaveBeenCalled();
    },
  );
});

describe('the service worker: its activation', () => {
  it('takes control of every open page of the app, a first visit’s included', async () => {
    const scope = fakeScope();
    const event = lifetime();
    onActivate(scope, event);
    await event.waited();
    expect(scope.clients.claim).toHaveBeenCalledTimes(1);
    expect(event.waits).toHaveLength(1); // the activation lasts until the pages are its own
  });
});
