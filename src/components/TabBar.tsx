import { NavLink } from 'react-router';
import { MAIN_DESTINATIONS, MOVE_PATH } from './destinations';
import { Orb } from './Orb';
import styles from './TabBar.module.css';

/**
 * The phone's tab bar, below 900 px: a `<nav aria-label="Main">` of five links (Home, Portfolio,
 * Move, Legacy, Profile), Move raised into the centre orb. The current destination gets
 * `aria-current="page"` and a lit satellite dot. It sits on the bottom edge above the home
 * indicator; render it inside the router.
 */
export function TabBar({ className }: { className?: string | undefined }) {
  return (
    <nav aria-label="Main" className={[styles.bar, className].filter(Boolean).join(' ')}>
      <ul className={styles.list}>
        {MAIN_DESTINATIONS.map(({ to, label, icon: Icon, end }) => {
          const move = to === MOVE_PATH;
          return (
            <li key={to} className={styles.item}>
              <NavLink
                to={to}
                end={Boolean(end)}
                className={(move ? styles.move : styles.tab) ?? ''}
              >
                {move ? (
                  <Orb size="lg" className={styles.orb}>
                    <Icon aria-hidden="true" />
                  </Orb>
                ) : (
                  <Icon aria-hidden="true" className={styles.icon} />
                )}
                <span className={styles.label}>{label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
