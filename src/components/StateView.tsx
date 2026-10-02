import { VisuallyHidden } from 'radix-ui';
import { useMotion } from '../design/useMotion';
import { Button } from './form/Button';
import styles from './StateView.module.css';

export type StateKind = 'loading' | 'empty' | 'error' | 'offline';

export interface StateViewProps {
  kind: StateKind;
  /** Replaces the kind's own title; for `loading`, the words read out instead of "Loading". */
  title?: string | undefined;
  /** One or two plain sentences: what happened, or what will appear here. */
  detail?: string | undefined;
  /** The way on: "Try again" for an error, the first step for an empty list. */
  action?: { label: string; onClick: () => void } | undefined;
  /** Skeleton lines while loading; 3 by default. */
  lines?: number | undefined;
  className?: string | undefined;
}

const TITLES: Record<Exclude<StateKind, 'loading'>, string> = {
  empty: 'Nothing here yet',
  error: "This didn't load",
  offline: "You're offline",
};

const OFFLINE_DETAIL = "This appears as soon as you're back online.";

/** A planet on its orbit: whole and lit when empty, broken when failed, unlit offline. */
function Glyph({ kind }: { kind: Exclude<StateKind, 'loading'> }) {
  return (
    <svg className={styles.glyph} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <ellipse
        className={styles.orbit}
        cx="24"
        cy="24"
        rx="21"
        ry="8.5"
        transform="rotate(-16 24 24)"
        pathLength={100}
        strokeDasharray={kind === 'error' ? '58 10 22 10' : undefined}
      />
      <circle className={styles.planet} cx="24" cy="24" r="7.5" />
      {kind !== 'offline' && <circle className={styles.moon} cx="42.5" cy="17.5" r="2.5" />}
    </svg>
  );
}

/**
 * The designed states of a list or screen: `loading` (skeleton lines in a status named
 * "Loading"), `empty`, `error` (announced as an alert) and `offline` (a status). Each has its own
 * plain title; `title` and `detail` say more, `action` offers the way on.
 */
export function StateView({ kind, title, detail, action, lines = 3, className }: StateViewProps) {
  const motion = useMotion().animate ? 'on' : 'off';

  if (kind === 'loading') {
    return (
      <div
        role="status"
        aria-label="Loading"
        className={[styles.loading, className].filter(Boolean).join(' ')}
      >
        <VisuallyHidden.Root>{title ?? 'Loading'}</VisuallyHidden.Root>
        <div className={styles.lines} data-motion={motion}>
          {Array.from({ length: Math.max(1, lines) }, (_, index) => (
            // A skeleton line is only its place.
            <span key={index} className={styles.line} data-skeleton-line />
          ))}
        </div>
      </div>
    );
  }

  const role = kind === 'error' ? 'alert' : kind === 'offline' ? 'status' : undefined;
  const words = detail ?? (kind === 'offline' ? OFFLINE_DETAIL : undefined);
  return (
    <div role={role} className={[styles.view, styles[kind], className].filter(Boolean).join(' ')}>
      <Glyph kind={kind} />
      <div className={styles.text}>
        <p className={styles.title}>{title ?? TITLES[kind]}</p>
        {words && <p className={styles.detail}>{words}</p>}
        {action && (
          <Button
            className={styles.action}
            size="sm"
            variant={kind === 'empty' ? 'primary' : 'outline'}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
