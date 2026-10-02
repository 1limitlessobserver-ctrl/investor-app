// UpdateToast while no version waits, and its hourly look for one. (UpdateToast.test.tsx is the
// plan's spec of the offer itself, with a version waiting.)

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'virtual:pwa-register/react';

/** What the toast registered its worker with, as the mocked hook last saw it. */
const registered = vi.hoisted(() => ({ options: undefined as RegisterSWOptions | undefined }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: RegisterSWOptions) => {
    registered.options = options;
    return {
      needRefresh: [false, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: () => Promise.resolve(),
    };
  },
}));
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
