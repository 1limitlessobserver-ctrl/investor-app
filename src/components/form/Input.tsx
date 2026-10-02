import type { ComponentProps } from 'react';
import { controlAttributes, useFieldControl } from './Field';
import styles from './Input.module.css';

export type InputProps = ComponentProps<'input'> & {
  /**
   * Marks the input invalid outside a Field (any message, or true); inside one, the Field's error
   * does it and shows the message.
   */
  error?: string | boolean | null | undefined;
};

/** Is an `aria-invalid` value one that means invalid? */
export function ariaInvalid(value: ComponentProps<'input'>['aria-invalid']): boolean {
  return value !== undefined && value !== false && value !== 'false';
}

/**
 * A single-line text input; a `ref` reaches the `<input>`. Inside a Field it takes the Field's
 * id, description and validity.
 */
export function Input({
  error,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...rest
}: InputProps) {
  const field = useFieldControl();
  return (
    <input
      {...rest}
      {...controlAttributes(field, {
        id,
        describedBy,
        invalid: Boolean(error) || ariaInvalid(invalid),
      })}
      className={[styles.input, className].filter(Boolean).join(' ')}
    />
  );
}
