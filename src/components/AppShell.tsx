import type { ReactNode } from 'react';
import { useLayout } from '../design/useLayout';
import { BrandMark, type BrandIdentity } from './BrandMark';
import { HeaderActions } from './HeaderActions';
import { ShellFrame } from './ShellFrame';
import { StatusBanners } from './StatusBanners';
import { TabBar } from './TabBar';
import styles from './AppShell.module.css';

/** What both shells show around a screen; the app fills it from its session. */
export interface ShellProps {
  /** The company's name and logo, from GET /brand; null until known (no mark is drawn). */
  brand: BrandIdentity | null;
  /** Unread alerts: the bell's badge on phones, the rail's Alerts link at 900 px and above. */
  unread: number;
  /** False shows the offline banner. */
  online: boolean;
  /** The screen: the route's `<Outlet />`. */
  children: ReactNode;
}

/**
 * The layout of the five main destinations. Below 900 px: a glass header with the brand mark,
 * the alerts bell and the Oracle orb, the banners, the screen, and the tab bar. At 900 px and
 * above: the rail (brand, the five, Alerts, Oracle) beside the screen, with the banners on top.
 * Render it inside the router; the screen brings its own `<h1>`.
 */
export function AppShell({ brand, unread, online, children }: ShellProps) {
  const layout = useLayout();
  const phone = layout === 'phone';
  return (
    <ShellFrame
      layout={layout}
      brand={brand}
      unread={unread}
      header={
        phone ? (
          <div className={styles.bar}>
            {brand && <BrandMark name={brand.name} logoDataUrl={brand.logoDataUrl} size="sm" />}
            <HeaderActions unread={unread} className={styles.actions} />
          </div>
        ) : null
      }
      banners={<StatusBanners online={online} />}
      footer={phone ? <TabBar /> : null}
    >
      {children}
    </ShellFrame>
  );
}
