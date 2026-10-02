// Whether the app's service worker is active, which a push subscription needs: the browser's
// `ready` never settles while no worker is registered (and a first visit's worker is still
// installing), so the wait is bounded.

/** How long a step that needs the worker waits for it. */
export const WORKER_WAIT_MS = 5_000;

/** The browser's service worker container; absent outside a secure context. */
function browserWorkers(): ServiceWorkerContainer | undefined {
  return (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
}

/**
 * True once the app's service worker is active; false where the browser has no service workers,
 * or none is active within WORKER_WAIT_MS.
 */
export async function workerReady(
  workers: ServiceWorkerContainer | undefined = browserWorkers(),
): Promise<boolean> {
  if (workers === undefined) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      workers.ready.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), WORKER_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
