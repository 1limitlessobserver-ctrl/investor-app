import type { HTMLAttributes } from 'react';
import styles from './Panel.module.css';

export type PanelProps = HTMLAttributes<HTMLElement> & {
  /** The element: a `section` by default (a region once `aria-labelledby` names it). */
  as?: 'section' | 'div' | 'article' | 'aside' | 'li' | undefined;
  /** Inner spacing; `none` for a list that brings its own rows. */
  padding?: 'none' | 'sm' | 'md' | 'lg' | undefined;
  /** Lights the edge with the accent: the panel that matters most on a screen. */
  glow?: boolean | undefined;
};

/**
 * A glass panel: translucent card colour over the backdrop, a hairline edge and a light-catch
 * along the top. Other attributes (`role`, `aria-*`, handlers) reach the element.
 */
export function Panel({
  as: Element = 'section',
  padding = 'md',
  glow = false,
  className,
  ...rest
}: PanelProps) {
  return (
    <Element
      {...rest}
      className={[styles.panel, styles[padding], glow && styles.glow, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
