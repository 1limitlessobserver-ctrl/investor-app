import { Bell } from 'lucide-react';
import { NavLink } from 'react-router';
import {
  ALERTS_PATH,
  MAIN_DESTINATIONS,
  MOVE_PATH,
  ORACLE_PATH,
  alertsLabel,
  badgeText,
} from './destinations';
import { Orb } from './Orb';
import styles from './NavRail.module.css';

export interface NavRailProps {
  /** Unread alerts: in the Alerts link's name ("Alerts, 3 unread") and its badge. */
  unread: number;
  className?: string | undefined;
}

/**
 * The navigation rail at 900 px and above: a `<nav aria-label="Main">` of seven links, the five
 * destinations and then Alerts and the Oracle. The current one gets `aria-current="page"`. Render
 * it inside the router.
 */
export function NavRail({ unread, className }: NavRailProps) {
  const badge = badgeText(unread);
  return (
    <nav aria-label="Main" className={[styles.rail, className].filter(Boolean).join(' ')}>
      <ul className={styles.list}>
        {MAIN_DESTINATIONS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={Boolean(end)} className={styles.link ?? ''}>
              {to === MOVE_PATH ? (
                <Orb size="md">
                  <Icon aria-hidden="true" />
                </Orb>
              ) : (
                <span className={styles.glyph}>
                  <Icon aria-hidden="true" />
                </span>
              )}
              <span className={styles.label}>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <ul className={`${styles.list} ${styles.secondary}`}>
        <li>
          <NavLink to={ALERTS_PATH} className={styles.link ?? ''} aria-label={alertsLabel(unread)}>
            <span className={styles.glyph}>
              <Bell aria-hidden="true" />
            </span>
            <span className={styles.label}>Alerts</span>
            {badge !== null && (
              <span className={styles.badge} data-badge aria-hidden="true">
                {badge}
              </span>
            )}
          </NavLink>
        </li>
        <li>
          <NavLink to={ORACLE_PATH} className={styles.link ?? ''}>
            <Orb size="md" tone="glass" />
            <span className={styles.label}>Oracle</span>
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
