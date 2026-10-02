import type { ReactNode } from 'react';
import styles from './Orb.module.css';

export interface OrbProps {
  /** 1.75rem (header), 2.25rem (rail) or 3.5rem (the tab bar's raised Move button). */
  size?: 'sm' | 'md' | 'lg';
  /** `solid`: a sphere of the accent (Move); `glass`: a clear sphere with an accent core (Oracle). */
  tone?: 'solid' | 'glass';
  /** An icon to hold, drawn in the accent's readable ink. */
  children?: ReactNode;
  className?: string | undefined;
}

/**
 * The app's signature shape: a small lit sphere on a tilted orbit. Decoration only; the link or
 * button around it carries the name.
 */
export function Orb({ size = 'md', tone = 'solid', children, className }: OrbProps) {
  return (
    <span
      className={[styles.orb, styles[size], styles[tone], className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
