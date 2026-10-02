// The two flags the session keeps outside secure storage. Neither is investor data, and a blocked
// storage reads as unset and keeps nothing (the failure is reported to the console).
//  - `app.lockEnabled` (localStorage): whether the device lock locks the app in the background
//    and on launch. Unset until the investor sets up a lock or turns it off.
//  - `app.sample` (sessionStorage): this tab has a sample session, so a reload keeps it.

import { reportProblem } from '../lib/report';

const LOCK_KEY = 'app.lockEnabled';
const SAMPLE_KEY = 'app.sample';

/**
 * Runs a read or write of web storage (`where` names it): on failure, it reports the failure and
 * answers `otherwise`.
 */
function attempt<T>(where: string, run: () => T, otherwise: T): T {
  try {
    return run();
  } catch (error) {
    reportProblem(where, error);
    return otherwise;
  }
}

export const lockPreference = {
  /** True or false once decided; null while unset. */
  read(): boolean | null {
    const value = attempt('reading the lock setting', () => localStorage.getItem(LOCK_KEY), null);
    return value === 'true' ? true : value === 'false' ? false : null;
  },
  write(on: boolean): void {
    attempt('saving the lock setting', () => localStorage.setItem(LOCK_KEY, String(on)), undefined);
  },
  /** Back to unset: the next sign-in on this device decides afresh. */
  clear(): void {
    attempt('clearing the lock setting', () => localStorage.removeItem(LOCK_KEY), undefined);
  },
  /** Another tab's storage event that may have changed it (null: that tab cleared it all). */
  changedBy(event: StorageEvent): boolean {
    return event.key === null || event.key === LOCK_KEY;
  },
};

export const sampleFlag = {
  read(): boolean {
    return attempt(
      'reading the sample flag',
      () => sessionStorage.getItem(SAMPLE_KEY) === '1',
      false,
    );
  },
  write(): void {
    attempt('saving the sample flag', () => sessionStorage.setItem(SAMPLE_KEY, '1'), undefined);
  },
  clear(): void {
    attempt('clearing the sample flag', () => sessionStorage.removeItem(SAMPLE_KEY), undefined);
  },
};
