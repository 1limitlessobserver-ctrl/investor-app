import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useLayout } from '../design/useLayout';
import type { ShellProps } from './AppShell';
import { HeaderActions } from './HeaderActions';
import { ShellFrame } from './ShellFrame';
import { StatusBanners } from './StatusBanners';
import styles from './FlowShell.module.css';

export interface FlowShellProps extends ShellProps {
  /** The screen's title, the page's `<h1>`. */
  title: string;
  /** Back: the app decides where (the previous screen, or the flow's hub). */
  onBack: () => void;
  /** The screen's own controls for the header (a "Mark all read", say). */
  actions?: ReactNode;
}

/**
 * The layout of detail screens and flows: Back, the title (the `<h1>`) and the screen's actions,
 * with the bell and Oracle orb on phones; no tab bar. At 900 px and above the rail stays (it
 * carries Alerts and the Oracle) and the header sits over the content column. Render it inside
 * the router.
 */
export function FlowShell({
  brand,
  unread,
  online,
  updateReady,
  onReload,
  title,
  onBack,
  actions,
  children,
}: FlowShellProps) {
  const layout = useLayout();
  return (
    <ShellFrame
      layout={layout}
      brand={brand}
      unread={unread}
      header={
        <div className={`${styles.bar} ${styles[layout]}`}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
            <ChevronLeft aria-hidden="true" />
          </button>
          <h1 className={styles.title}>{title}</h1>
          {actions !== undefined && actions !== null && (
            <div className={styles.actions}>{actions}</div>
          )}
          {layout === 'phone' && <HeaderActions unread={unread} />}
        </div>
      }
      banners={<StatusBanners online={online} updateReady={updateReady} onReload={onReload} />}
    >
      {children}
    </ShellFrame>
  );
}
