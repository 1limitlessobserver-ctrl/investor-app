import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_WAIT_MS, workerReady } from './workerReady';

/** A service worker container whose `ready` settles when the test says. */
function container() {
  let activate!: () => void;
  const ready = new Promise<ServiceWorkerRegistration>((resolve) => {
    activate = () => resolve({ active: {} } as ServiceWorkerRegistration);
  });
  return { container: { ready } as ServiceWorkerContainer, activate };
}

describe('workerReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers true once the app’s service worker is active', async () => {
    const { container: workers, activate } = container();
    const answer = workerReady(workers);
    activate();
    await expect(answer).resolves.toBe(true);
  });

  it('answers false when no worker is active within five seconds', async () => {
    const { container: workers } = container();
    const answer = workerReady(workers);
    await vi.advanceTimersByTimeAsync(WORKER_WAIT_MS - 1);
    let settled = false;
    void answer.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(answer).resolves.toBe(false);
    expect(WORKER_WAIT_MS).toBe(5_000);
  });

  it('leaves no timer behind once the worker answers', async () => {
    const { container: workers, activate } = container();
    const answer = workerReady(workers);
    activate();
    await answer;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers false where the browser has no service workers, as here', async () => {
    expect('serviceWorker' in navigator).toBe(false);
    await expect(workerReady()).resolves.toBe(false);
  });
});
