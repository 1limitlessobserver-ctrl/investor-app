import { ArrowLeftRight, ChartPie, CircleUserRound, House, Sprout } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (Home), not below it. */
  end?: boolean;
}

/** The five main destinations, in tab order: the phone's tab bar and the top of the rail. */
export const MAIN_DESTINATIONS: readonly Destination[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/portfolio', label: 'Portfolio', icon: ChartPie },
  { to: '/move', label: 'Move', icon: ArrowLeftRight },
  { to: '/legacy', label: 'Legacy', icon: Sprout },
  { to: '/profile', label: 'Profile', icon: CircleUserRound },
];

/** The destination the tab bar raises into an orb. */
export const MOVE_PATH = '/move';
export const ALERTS_PATH = '/alerts';
export const ORACLE_PATH = '/oracle';

/** The bell's name, which carries the count: "Alerts, 3 unread". */
export function alertsLabel(unread: number): string {
  return `Alerts, ${unread} unread`;
}

/** The badge's text: nothing at zero, then the count up to "99+". */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}
