import { useId, type ReactNode } from 'react';
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
 * The layout of detail screens and flows: Back, the title (the `<h1>`, which also names `<main>`)
 * and the screen's actions, with the bell and Oracle orb on phones; no tab bar. On phones the
 * controls take the first row and the title the whole second, so a long title wraps instead of
 * squeezing. At 900 px and above the rail stays (it carries Alerts and the Oracle) and Back, title
 * and actions share one row over the content column. Render it inside the router.
 */
export function FlowShell({
  brand,
  unread,
  online,
  title,
  onBack,
  actions,
  children,
}: FlowShellProps) {
  const layout = useLayout();
  const titleId = useId();
  return (
    <ShellFrame
      layout={layout}
      brand={brand}
      unread={unread}
      mainLabelledBy={titleId}
      header={
        <div className={`${styles.bar} ${styles[layout]}`}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
            <ChevronLeft aria-hidden="true" />
          </button>
          <h1 id={titleId} className={styles.title}>
            {title}
          </h1>
          {actions !== undefined && actions !== null && (
            <div className={styles.actions}>{actions}</div>
          )}
          {layout === 'phone' && <HeaderActions unread={unread} className={styles.shellActions} />}
        </div>
      }
      banners={<StatusBanners online={online} />}
    >
      {children}
    </ShellFrame>
  );
}
