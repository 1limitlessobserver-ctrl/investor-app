import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reportProblem } from '../lib/report';
import { useRegisterSW } from '../pwa/register';
import { Button } from './form/Button';
import styles from './UpdateToast.module.css';

/** How often the open app asks whether a newer version has been published. */
export const UPDATE_CHECK_MS = 60 * 60_000;

/** Asks the server for a newer service worker; offline there is no one to ask until the next. */
function checkForUpdate(registration: ServiceWorkerRegistration): void {
  if (!navigator.onLine) return;
  registration.update().catch((error: unknown) => {
    reportProblem('checking for a new version', error);
  });
}

/**
 * Registers the app's service worker, and offers a newer version once one is waiting: "Update
 * available" with Reload, which hands over to it and reloads. It never reloads on its own, so no
 * flow is cut short: the new version takes over every open tab at once, but only the tab whose
 * Reload asked for it reloads; the others keep the offer, and their Reload then simply reloads.
 * The browser looks for a new version at launch; this looks again every hour while the app stays
 * open. Mount it once, outside the router. Its live region is always in the page, empty until
 * there is something to offer, so the offer is announced when it comes.
 */
export function UpdateToast() {
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(true);
  // This tab's Reload asked for the new version.
  const asked = useRef(false);
  // The new version controls this page already (another tab's Reload handed over to it).
  const [inControl, setInControl] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearInterval(timer.current);
    };
  }, []);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (asked.current) window.location.reload();
      else setInControl(true);
    },
    onRegisteredSW(_url, registration) {
      // The registration answers after the first render; once the toast is gone, nothing checks.
      if (registration === undefined || !mounted.current) return;
      clearInterval(timer.current);
      timer.current = setInterval(() => checkForUpdate(registration), UPDATE_CHECK_MS);
    },
    onRegisterError(error: unknown) {
      reportProblem('registering the service worker', error);
    },
  });

  async function reload() {
    // Nothing waits to be handed over any more: the page reloads into the new version.
    if (inControl) {
      window.location.reload();
      return;
    }
    asked.current = true;
    try {
      await updateServiceWorker(true);
    } catch (error) {
      reportProblem('updating the app', error);
    }
  }

  return (
    <div className={styles.toast} data-shown={needRefresh || undefined}>
      {needRefresh && <RefreshCw aria-hidden="true" className={styles.icon} />}
      <p role="status" aria-label="Update" className={styles.message}>
        {needRefresh && 'Update available'}
      </p>
      {needRefresh && (
        <Button size="sm" variant="outline" onClick={() => void reload()}>
          Reload
        </Button>
      )}
    </div>
  );
}
