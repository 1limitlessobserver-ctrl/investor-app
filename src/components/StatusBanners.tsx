import { WifiOff } from 'lucide-react';
import styles from './StatusBanners.module.css';

export interface StatusBannersProps {
  /** False shows the offline banner. */
  online: boolean;
  className?: string | undefined;
}

/**
 * The app-wide notice under the header: a status named "Connection", always present so a change
 * is announced, empty while online and "You're offline…" otherwise. (A new version of the app is
 * offered by UpdateToast, mounted once for the whole app.)
 */
export function StatusBanners({ online, className }: StatusBannersProps) {
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
    </div>
  );
}
