import { Bell } from 'lucide-react';
import { NavLink } from 'react-router';
import { ALERTS_PATH, ORACLE_PATH, alertsLabel, badgeText } from './destinations';
import { Orb } from './Orb';
import styles from './HeaderActions.module.css';

export interface HeaderActionsProps {
  /** Unread alerts: in the bell's name ("Alerts, 3 unread") and its badge (none at zero). */
  unread: number;
  className?: string | undefined;
}

/**
 * The header's bell and Oracle orb on phones: links to /alerts and /oracle (rendered inside the
 * router), marked `aria-current="page"` on their own screens. At 900 px and above the rail
 * carries both instead.
 */
export function HeaderActions({ unread, className }: HeaderActionsProps) {
  const badge = badgeText(unread);
  return (
    <div className={[styles.actions, className].filter(Boolean).join(' ')}>
      <NavLink to={ALERTS_PATH} className={styles.action ?? ''} aria-label={alertsLabel(unread)}>
        <Bell aria-hidden="true" className={styles.bell} />
        {badge !== null && (
          <span className={styles.badge} data-badge aria-hidden="true">
            {badge}
          </span>
        )}
      </NavLink>
      <NavLink to={ORACLE_PATH} className={styles.action ?? ''} aria-label="Oracle">
        <Orb size="sm" tone="glass" />
      </NavLink>
    </div>
  );
}
