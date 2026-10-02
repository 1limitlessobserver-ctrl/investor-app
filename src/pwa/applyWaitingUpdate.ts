// Taking the newest version at once, for the update screen (UpdateRequired): the app's shell is
// precached, so a plain reload would open the same version again. This asks the server for the
// newest worker; the one waiting (or the one installing, once it has installed) is told to take
// over, and the page reloads as soon as the new version controls it. Where no worker waits, or
// none takes over in time, the page reloads as it is. Its promise settles once it has reloaded,
// so the screen can show its Reload busy until then.

import { reportProblem } from '../lib/report';
import { browserWorkers } from './workerReady';

/** How long a new worker still installing, or one told to take over, is waited for. */
export const TAKE_OVER_WAIT_MS = 10_000;

export interface ApplyUpdateOptions {
  /** The browser's service workers unless a spec passes its own. */
  workers?: ServiceWorkerContainer | undefined;
  /** Reloads the page; the browser's reload unless a spec passes its own. */
  reload?: (() => void) | undefined;
}

export async function applyWaitingUpdate({
  workers = browserWorkers(),
  reload = () => window.location.reload(),
}: ApplyUpdateOptions = {}): Promise<void> {
  const registration = await workers?.getRegistration().catch(() => undefined);
  if (workers === undefined || registration === undefined) {
    reload();
    return;
  }
  try {
    await registration.update();
  } catch (error) {
    // Offline, or the server could not say: a worker already waiting still takes over.
    reportProblem('looking for the new version', error);
  }
  const waiting = registration.waiting ?? (await installed(registration.installing));
  if (waiting === null) {
    reload();
    return;
  }
  await new Promise<void>((resolve) => {
    let done = false;
    const reloadOnce = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reload();
      resolve();
    };
    const timer = setTimeout(reloadOnce, TAKE_OVER_WAIT_MS);
    workers.addEventListener('controllerchange', reloadOnce, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
}

/** The worker once it has installed; null when there is none, it fails, or it takes too long. */
function installed(worker: ServiceWorker | null): Promise<ServiceWorker | null> {
  if (worker === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const settle = (answer: ServiceWorker | null) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      resolve(answer);
    };
    const changed = () => {
      if (worker.state === 'installed') settle(worker);
      else if (worker.state === 'redundant') settle(null);
    };
    const timer = setTimeout(() => settle(null), TAKE_OVER_WAIT_MS);
    worker.addEventListener('statechange', changed);
    changed();
  });
}
