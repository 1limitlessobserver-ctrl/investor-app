import type { Brand } from '../api/types';
import styles from './BrandMark.module.css';

/** The part of the brand a mark needs; a whole `Brand` will do. */
export type BrandIdentity = Pick<Brand, 'name' | 'logoDataUrl'>;

export interface BrandMarkProps {
  /** The company's name, from GET /brand. */
  name: string;
  /** The logo as a data URL, or null for a monogram of the name's first letter. */
  logoDataUrl?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Writes the name beside the logo (the default); without it, the logo or monogram names it. */
  showName?: boolean;
  className?: string | undefined;
}

/**
 * The company's mark: its logo, or a monogram disc when it has none, and its name in the display
 * face. A long name wraps to two lines and then ends with an ellipsis.
 */
export function BrandMark({
  name,
  logoDataUrl = null,
  size = 'md',
  showName = true,
  className,
}: BrandMarkProps) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '';
  const mark = logoDataUrl ? (
    <img className={styles.logo} src={logoDataUrl} alt={showName ? '' : name} />
  ) : showName ? (
    <span className={styles.monogram} data-monogram aria-hidden="true">
      {initial}
    </span>
  ) : (
    <span className={styles.monogram} data-monogram role="img" aria-label={name}>
      {initial}
    </span>
  );

  return (
    <span className={[styles.brand, styles[size], className].filter(Boolean).join(' ')}>
      {mark}
      {showName && <span className={styles.name}>{name}</span>}
    </span>
  );
}
