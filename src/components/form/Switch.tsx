import type { ComponentProps } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';
import { controlAttributes, useFieldControl } from './Field';
import { ariaInvalid } from './Input';
import styles from './Switch.module.css';

export type SwitchProps = ComponentProps<typeof RadixSwitch.Root>;

/**
 * An on/off switch (`role="switch"`) over Radix: `checked` with `onCheckedChange(next)`, or
 * `defaultChecked` to keep its own state. Name it with a Field (`inline` puts it beside the
 * label) or `aria-label`. Space and Enter toggle it.
 */
export function Switch({
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...rest
}: SwitchProps) {
  const field = useFieldControl();
  return (
    <RadixSwitch.Root
      {...rest}
      {...controlAttributes(field, { id, describedBy, invalid: ariaInvalid(invalid) })}
      className={[styles.root, className].filter(Boolean).join(' ')}
    >
      <RadixSwitch.Thumb className={styles.thumb} />
    </RadixSwitch.Root>
  );
}
