import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from './form/Button';
import styles from './StatusBanners.module.css';

export interface StatusBannersProps {
  /** False shows the offline banner. */
  online: boolean;
  /** A new version of the app is waiting; shows "Update available" with Reload. */
  updateReady?: boolean | undefined;
  /** What Reload does (apply the waiting version); without it the banner has no button. */
  onReload?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * The app-wide notices under the header. Two live regions are always present, so a change is
 * announced: a status named "Connection" (empty while online; "You're offline…" otherwise) and
 * one named "Update" (empty unless `updateReady`).
 */
export function StatusBanners({
  online,
  updateReady = false,
  onReload,
  className,
}: StatusBannersProps) {
  return (
    <div className={[styles.banners, className].filter(Boolean).join(' ')}>
      <div role="status" aria-label="Connection">
        {!online && (
          <p className={`${styles.banner} ${styles.offline}`}>
            <WifiOff aria-hidden="true" className={styles.icon} />
            <span>You&apos;re offline. Balances are hidden until you reconnect.</span>
          </p>
        )}
      </div>
      <div role="status" aria-label="Update">
        {updateReady && (
          <div className={`${styles.banner} ${styles.update}`}>
            <RefreshCw aria-hidden="true" className={styles.icon} />
            <span className={styles.message}>Update available</span>
            {onReload && (
              <Button size="sm" variant="outline" onClick={onReload}>
                Reload
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
