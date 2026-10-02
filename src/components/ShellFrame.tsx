import { useRef, type MouseEvent, type ReactNode } from 'react';
import { BrandMark, type BrandIdentity } from './BrandMark';
import { NavRail } from './NavRail';
import styles from './ShellFrame.module.css';

export interface ShellFrameProps {
  layout: 'phone' | 'wide';
  brand: BrandIdentity | null;
  /** For the rail's Alerts link at 900 px and above. */
  unread: number;
  /** The shell's bar: sticky glass at the top on phones, over the content column at 900 px+. */
  header: ReactNode;
  /** StatusBanners: in the sticky header on phones, atop the content column at 900 px+. */
  banners: ReactNode;
  /** Under the content on phones only (the tab bar). */
  footer?: ReactNode;
  /** The id of a heading outside `<main>` that names it: FlowShell's title, in the header bar. */
  mainLabelledBy?: string | undefined;
  children: ReactNode;
}

/**
 * The structure AppShell and FlowShell share. Phones: a sticky header holding the shell's bar
 * and the banners, the screen in `<main>`, then the footer. 900 px and above: a rail with the
 * brand mark and NavRail beside a centred content column (at most 720 px). A skip link comes
 * first. It sits above the SpaceBackdrop and honours the safe-area insets.
 */
export function ShellFrame({
  layout,
  brand,
  unread,
  header,
  banners,
  footer,
  mainLabelledBy,
  children,
}: ShellFrameProps) {
  const main = useRef<HTMLElement>(null);

  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    main.current?.focus();
  }

  const skip = (
    <a href="#main" className={styles.skip} onClick={skipToContent}>
      Skip to content
    </a>
  );
  const content = (
    <main
      ref={main}
      id="main"
      tabIndex={-1}
      className={styles.main}
      aria-labelledby={mainLabelledBy}
    >
      {children}
    </main>
  );

  if (layout === 'wide') {
    return (
      <div className={`${styles.frame} ${styles.wide}`} data-layout="wide">
        {skip}
        <div className={styles.rail}>
          {brand && (
            <BrandMark
              name={brand.name}
              logoDataUrl={brand.logoDataUrl}
              size="sm"
              className={styles.brand}
            />
          )}
          <NavRail unread={unread} />
        </div>
        <div className={styles.column}>
          {header !== null && header !== undefined && (
            <header className={styles.top}>{header}</header>
          )}
          <div className={styles.banners}>{banners}</div>
          {content}
        </div>
      </div>
    );
  }

  const hasFooter = footer !== null && footer !== undefined;
  return (
    <div
      className={`${styles.frame} ${styles.phone}`}
      data-layout="phone"
      data-footer={hasFooter || undefined}
    >
      {skip}
      <header className={styles.header}>
        {header}
        {banners}
      </header>
      {content}
      {footer}
    </div>
  );
}
