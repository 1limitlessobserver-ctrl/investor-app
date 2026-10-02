// UpdateToast beyond the plan's spec of the offer (UpdateToast.test.tsx): while no version waits,
// its hourly look for one, and how a waiting version takes over when several tabs are open.

import { MutationObserver } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'virtual:pwa-register/react';

/**
 * What the toast registered its worker with, as the mocked hook last saw it; whether a version
 * waits; and the hook's updateServiceWorker.
 */
interface Registered {
  options: RegisterSWOptions | undefined;
  waiting: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}
const registered = vi.hoisted((): Registered => ({
  options: undefined,
  waiting: false,
  updateServiceWorker: () => Promise.resolve(),
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: RegisterSWOptions) => {
    registered.options = options;
    return {
      needRefresh: [registered.waiting, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: (reloadPage?: boolean) => registered.updateServiceWorker(reloadPage),
    };
  },
}));
import { createQueryClient } from '../queries/client';
import { UpdateToast } from './UpdateToast';

const HOUR = 60 * 60_000;

/** The browser answers the registration: a worker whose update() the test watches. */
function registerWorker(update = vi.fn(() => Promise.resolve())) {
  const registration = { update } as unknown as ServiceWorkerRegistration;
  act(() => registered.options?.onRegisteredSW?.('/sw.js', registration));
  return update;
}

const goOffline = (offline: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value: !offline, configurable: true });

describe('UpdateToast, while no version waits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registered.options = undefined;
    registered.waiting = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps its live region in the page, empty, and offers nothing', () => {
    render(<UpdateToast />);
    expect(screen.getByRole('status', { name: 'Update' })).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('looks for a new version every hour once its worker is registered', () => {
    render(<UpdateToast />);
    const update = registerWorker();
    vi.advanceTimersByTime(HOUR - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOUR);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('skips the look while offline, and looks again at the next hour online', () => {
    render(<UpdateToast />);
    const update = registerWorker();
    goOffline(true);
    vi.advanceTimersByTime(HOUR);
    expect(update).not.toHaveBeenCalled();
    goOffline(false);
    vi.advanceTimersByTime(HOUR);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reports a look that fails, and looks again the next hour', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new TypeError('Failed to update a ServiceWorker');
    render(<UpdateToast />);
    const update = registerWorker(vi.fn(() => Promise.reject(failure)));
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(warn).toHaveBeenCalledWith('[investor-app] checking for a new version:', failure);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('stops looking once it is gone, and never starts for a worker registered after', () => {
    const first = render(<UpdateToast />);
    const update = registerWorker();
    first.unmount();
    vi.advanceTimersByTime(2 * HOUR);
    expect(update).not.toHaveBeenCalled();

    const second = render(<UpdateToast />);
    const options = registered.options;
    second.unmount();
    const late = vi.fn(() => Promise.resolve());
    options?.onRegisteredSW?.('/sw.js', { update: late } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(2 * HOUR);
    expect(late).not.toHaveBeenCalled();
  });

  it('schedules nothing where the browser gives no registration', () => {
    render(<UpdateToast />);
    expect(() =>
      act(() => registered.options?.onRegisteredSW?.('/sw.js', undefined)),
    ).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a worker that could not be registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new DOMException('The script resource is behind a redirect', 'SecurityError');
    render(<UpdateToast />);
    registered.options?.onRegisterError?.(failure);
    expect(warn).toHaveBeenCalledWith('[investor-app] registering the service worker:', failure);
  });
});

/** Watches the page's reloads: jsdom's location.reload cannot be spied on, so location is stubbed. */
function watchReloads() {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

describe('UpdateToast, as a waiting version takes over', () => {
  beforeEach(() => {
    registered.options = undefined;
    registered.waiting = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reloads this tab once the new version takes over after its own Reload', async () => {
    const reload = watchReloads();
    const update = vi.fn(() => Promise.resolve());
    registered.updateServiceWorker = update;
    render(<UpdateToast />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(update).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled(); // not before the new version is in control
    act(() => registered.options?.onNeedReload?.());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps its page when another tab’s Reload hands over, and then reloads plainly', async () => {
    const reload = watchReloads();
    const update = vi.fn(() => Promise.resolve());
    registered.updateServiceWorker = update;
    render(<UpdateToast />);
    act(() => registered.options?.onNeedReload?.()); // another tab chose Reload
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Update' })).toHaveTextContent('Update available');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    // The new version is in control already: nothing waits to be handed over.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('UpdateToast, while the app is sending a change', () => {
  beforeEach(() => {
    registered.waiting = true;
  });

  it('holds Reload until the change has gone, so a reload never cuts it short', async () => {
    const queryClient = createQueryClient();
    let sent!: () => void;
    const gone = new Promise<void>((resolve) => (sent = resolve));
    const sending = new MutationObserver(queryClient, { mutationFn: () => gone });
    void sending.mutate();
    render(<UpdateToast queryClient={queryClient} />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    act(() => sent());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled());
  });

  it('offers Reload at once while nothing is being sent', () => {
    render(<UpdateToast queryClient={createQueryClient()} />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
  });
});
