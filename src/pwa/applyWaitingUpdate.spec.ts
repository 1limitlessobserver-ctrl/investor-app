import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKE_OVER_WAIT_MS, applyWaitingUpdate } from './applyWaitingUpdate';

/** A service worker of the app, in `state`, whose state the test moves on. */
function fakeWorker(state: ServiceWorkerState) {
  const listeners = new Set<() => void>();
  const worker = {
    state,
    postMessage: vi.fn(),
    addEventListener: (_type: 'statechange', listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: 'statechange', listener: () => void) =>
      void listeners.delete(listener),
    become(next: ServiceWorkerState) {
      worker.state = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return worker;
}
type FakeWorker = ReturnType<typeof fakeWorker>;

/** The browser's service workers: the app's registration, and its controllerchange event. */
function fakeWorkers(
  registration: {
    waiting?: FakeWorker | null;
    installing?: FakeWorker | null;
    update?: () => Promise<unknown>;
  } | null,
) {
  const changes = new Set<() => void>();
  const found =
    registration === null
      ? undefined
      : {
          waiting: registration.waiting ?? null,
          installing: registration.installing ?? null,
          update: vi.fn(registration.update ?? (() => Promise.resolve())),
        };
  const workers = {
    getRegistration: () => Promise.resolve(found),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'controllerchange') changes.add(listener);
    },
  } as unknown as ServiceWorkerContainer;
  /** The new worker takes over the page. */
  const takeOver = () => {
    for (const listener of [...changes]) listener();
  };
  return { workers, registration: found, takeOver };
}

describe('applyWaitingUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the waiting worker to take over, and reloads once it controls the page', async () => {
    const waiting = fakeWorker('installed');
    const { workers, registration, takeOver } = fakeWorkers({ waiting });
    const reload = vi.fn();
    await applyWaitingUpdate({ workers, reload });
    expect(registration?.update).toHaveBeenCalledTimes(1); // the newest version, from the server
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled(); // not before the new version controls the page
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads plainly, once it has asked the server, when no worker waits', async () => {
    const { workers, registration } = fakeWorkers({});
    const reload = vi.fn();
    await applyWaitingUpdate({ workers, reload });
    expect(registration?.update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads plainly where no worker is registered', async () => {
    const { workers } = fakeWorkers(null);
    const reload = vi.fn();
    await applyWaitingUpdate({ workers, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads plainly where the browser has no service workers, as here', async () => {
    expect('serviceWorker' in navigator).toBe(false);
    const reload = vi.fn();
    await applyWaitingUpdate({ reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for a new worker still installing, then hands over to it', async () => {
    const installing = fakeWorker('installing');
    const { workers, takeOver } = fakeWorkers({ installing });
    const reload = vi.fn();
    const applying = applyWaitingUpdate({ workers, reload });
    await vi.advanceTimersByTimeAsync(0);
    expect(installing.postMessage).not.toHaveBeenCalled();
    installing.become('installed');
    await applying;
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads plainly when the new worker fails to install', async () => {
    const installing = fakeWorker('installing');
    const { workers } = fakeWorkers({ installing });
    const reload = vi.fn();
    const applying = applyWaitingUpdate({ workers, reload });
    await vi.advanceTimersByTimeAsync(0);
    installing.become('redundant');
    await applying;
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still hands over to the waiting worker when the server cannot be asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new TypeError('Failed to update a ServiceWorker: network error');
    const waiting = fakeWorker('installed');
    const { workers, takeOver } = fakeWorkers({ waiting, update: () => Promise.reject(failure) });
    const reload = vi.fn();
    await applyWaitingUpdate({ workers, reload });
    expect(warn).toHaveBeenCalledWith('[investor-app] looking for the new version:', failure);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads all the same, once, when the new version never takes over in time', async () => {
    const waiting = fakeWorker('installed');
    const { workers, takeOver } = fakeWorkers({ waiting });
    const reload = vi.fn();
    await applyWaitingUpdate({ workers, reload });
    await vi.advanceTimersByTimeAsync(TAKE_OVER_WAIT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    takeOver(); // late
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
