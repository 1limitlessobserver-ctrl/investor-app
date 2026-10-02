import type { ComponentProps, MouseEvent } from 'react';
import { Slot } from 'radix-ui';
import { useMotion } from '../../design/useMotion';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ComponentProps<'button'> & {
  /** Its weight: `primary` (the default) for the one main action, `destructive` for loss. */
  variant?: ButtonVariant | undefined;
  /** Its scale, `md` by default; every size keeps a 44 px target. */
  size?: ButtonSize | undefined;
  /**
   * Work is under way: the label stays, a spinner shows, the button says it is busy and ignores
   * presses (its form does not submit either), and it keeps focus, unlike a disabled one.
   */
  loading?: boolean | undefined;
  /**
   * Lends the button's look to its single child, a link say, instead of rendering a `<button>`.
   * The other props (attributes, `onClick`, `ref`) pass on to the child, merged with its own;
   * `loading` and `type` do not apply.
   */
  asChild?: boolean | undefined;
};

function Spinner() {
  const { animate } = useMotion();
  return (
    <span className={styles.spinner} data-motion={animate ? 'on' : 'off'} aria-hidden="true" />
  );
}

/**
 * The app's button. `type` is "button" unless set, so a press never submits a form by accident:
 * pass `type="submit"` for a form's main action. A `ref` reaches the `<button>` (with `asChild`,
 * the child).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');

  if (asChild) {
    return (
      <Slot.Root {...rest} className={classes} onClick={onClick}>
        {children}
      </Slot.Root>
    );
  }

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
      className={classes}
      onClick={handleClick}
    >
      {loading && <Spinner />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
