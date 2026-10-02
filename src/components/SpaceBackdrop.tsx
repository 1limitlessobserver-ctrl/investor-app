import { Starfield } from './Starfield';
import styles from './SpaceBackdrop.module.css';

export interface SpaceBackdropProps {
  /**
   * The space scene: the living starfield over a planet's lit horizon. For the themes whose
   * tokens say `starfield` (Orbital and Aurora): `themes.tokens(theme).starfield`.
   */
  starfield?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The app's background, fixed behind everything: the theme's background with a soft glow of
 * the accent from above, and for the space themes the starfield and a planet's horizon. It is
 * decoration (hidden from assistive technology, never takes a tap). Render it once at the app's
 * root, outside the routes, so navigation never restarts the sky; content above it needs
 * `position: relative` (the shells have it).
 */
export function SpaceBackdrop({ starfield = false, className }: SpaceBackdropProps) {
  return (
    <div
      className={[styles.backdrop, className].filter(Boolean).join(' ')}
      data-space={starfield || undefined}
      aria-hidden="true"
    >
      {starfield && <Starfield />}
    </div>
  );
}
