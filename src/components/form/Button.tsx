import type { ComponentProps, MouseEvent } from 'react';
import { useMotion } from '../../design/useMotion';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ComponentProps<'button'> & {
  /** Its weight: `primary` (the default) for the one main action, `destructive` for loss. */
  variant?: ButtonVariant;
  /** Its scale, `md` by default; every size keeps a 44 px target. */
  size?: ButtonSize;
  /**
   * Work is under way: the label stays, a spinner shows, the button says it is busy and ignores
   * presses (its form does not submit either), and it keeps focus, unlike a disabled one.
   */
  loading?: boolean;
};

function Spinner() {
  const { animate } = useMotion();
  return (
    <span className={styles.spinner} data-motion={animate ? 'on' : 'off'} aria-hidden="true" />
  );
}

/**
 * The app's button. `type` is "button" unless set, so a press never submits a form by accident:
 * pass `type="submit"` for a form's main action. A `ref` reaches the `<button>`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled']}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      {loading && <Spinner />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
