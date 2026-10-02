// The two flags the session keeps outside secure storage. Neither is investor data, and a blocked
// storage reads as unset and keeps nothing.
//  - `app.lockEnabled` (localStorage): whether the device lock locks the app in the background
//    and on launch. Unset until the investor sets up a lock or turns it off.
//  - `app.sample` (sessionStorage): this tab has a sample session, so a reload keeps it.

const LOCK_KEY = 'app.lockEnabled';
const SAMPLE_KEY = 'app.sample';

function attempt<T>(run: () => T, otherwise: T): T {
  try {
    return run();
  } catch {
    return otherwise;
  }
}

export const lockPreference = {
  /** True or false once decided; null while unset. */
  read(): boolean | null {
    const value = attempt(() => localStorage.getItem(LOCK_KEY), null);
    return value === 'true' ? true : value === 'false' ? false : null;
  },
  write(on: boolean): void {
    attempt(() => localStorage.setItem(LOCK_KEY, String(on)), undefined);
  },
  /** Back to unset: the next sign-in on this device decides afresh. */
  clear(): void {
    attempt(() => localStorage.removeItem(LOCK_KEY), undefined);
  },
  /** Another tab's storage event that may have changed it (null: that tab cleared it all). */
  changedBy(event: StorageEvent): boolean {
    return event.key === null || event.key === LOCK_KEY;
  },
};

export const sampleFlag = {
  read(): boolean {
    return attempt(() => sessionStorage.getItem(SAMPLE_KEY) === '1', false);
  },
  write(): void {
    attempt(() => sessionStorage.setItem(SAMPLE_KEY, '1'), undefined);
  },
  clear(): void {
    attempt(() => sessionStorage.removeItem(SAMPLE_KEY), undefined);
  },
};
