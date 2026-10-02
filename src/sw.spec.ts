// The service worker's wiring (src/sw.ts), with Workbox stood in for: the precache and its routes,
// and src/pwa/handlers.ts on the worker's own events (the handlers' own spec is beside them). Like
// src/sw.ts, this is typechecked with the worker's library (tsconfig.sw.json).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Route {
  handler: unknown;
  options: { denylist: RegExp[] };
}

const workbox = vi.hoisted(() => ({
  precacheAndRoute: vi.fn<(entries: unknown) => void>(),
  cleanupOutdatedCaches: vi.fn<() => void>(),
  createHandlerBoundToURL: vi.fn((url: string) => ({ boundTo: url })),
  registerRoute: vi.fn<(route: Route) => void>(),
}));
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: workbox.precacheAndRoute,
  cleanupOutdatedCaches: workbox.cleanupOutdatedCaches,
  createHandlerBoundToURL: workbox.createHandlerBoundToURL,
}));
vi.mock('workbox-routing', () => ({
  NavigationRoute: class {
    handler: unknown;
    options: unknown;
    constructor(handler: unknown, options: unknown) {
      this.handler = handler;
      this.options = options;
    }
  },
  registerRoute: workbox.registerRoute,
}));

type Listener = (event: unknown) => void;

/** The worker's global scope, as far as src/sw.ts and the handlers use it. */
function fakeWorker() {
  const listeners = new Map<string, Listener>();
  return {
    __WB_MANIFEST: [{ url: 'index.html', revision: 'r1' }],
    addEventListener: vi.fn(
      (type: string, listener: Listener) => void listeners.set(type, listener),
    ),
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: {
      matchAll: vi.fn(() => Promise.resolve([])),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
    listeners,
  };
}

/** Loads src/sw.ts afresh, as a browser starts the worker, in `worker`'s scope. */
async function start(worker: ReturnType<typeof fakeWorker>) {
  vi.stubGlobal('self', worker);
  await import('./sw');
  return (type: string) => {
    const listener = worker.listeners.get(type);
    if (listener === undefined) throw new Error(`The worker does not listen to ${type}.`);
    return listener;
  };
}

describe('the service worker', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('precaches the build and drops the precaches of older Workbox versions', async () => {
    const worker = fakeWorker();
    await start(worker);
    expect(workbox.precacheAndRoute).toHaveBeenCalledWith(worker.__WB_MANIFEST);
    expect(workbox.cleanupOutdatedCaches).toHaveBeenCalledTimes(1);
  });

  it('answers every navigation with the precached shell, except the API’s', async () => {
    await start(fakeWorker());
    expect(workbox.createHandlerBoundToURL).toHaveBeenCalledWith('/index.html');
    expect(workbox.registerRoute).toHaveBeenCalledTimes(1);
    const route = workbox.registerRoute.mock.calls[0]?.[0];
    expect(route?.handler).toEqual({ boundTo: '/index.html' });
    const denied = (path: string) => route?.options.denylist.some((pattern) => pattern.test(path));
    expect(denied('/api/mobile/v1/brand')).toBe(true);
    expect(denied('/_api/anything')).toBe(true);
    expect(denied('/portfolio')).toBe(false);
    expect(denied('/alerts?open=al_1')).toBe(false);
  });

  it('shows a push as a notification', async () => {
    const worker = fakeWorker();
    const on = await start(worker);
    const waitUntil = vi.fn();
    on('push')({ data: { json: () => ({ notificationId: 'al_1', title: 'Hello' }) }, waitUntil });
    expect(worker.registration.showNotification).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ tag: 'al_1' }),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('opens the alert a tapped notification names', async () => {
    const worker = fakeWorker();
    const on = await start(worker);
    const waits: Promise<unknown>[] = [];
    on('notificationclick')({
      notification: { close: () => {}, data: { notificationId: 'al_1' } },
      waitUntil: (promise: Promise<unknown>) => void waits.push(promise),
    });
    await Promise.all(waits);
    expect(worker.clients.openWindow).toHaveBeenCalledWith('/alerts?open=al_1');
  });

  it('takes over when the app asks it to', async () => {
    const worker = fakeWorker();
    const on = await start(worker);
    on('message')({ data: { type: 'SKIP_WAITING' } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
