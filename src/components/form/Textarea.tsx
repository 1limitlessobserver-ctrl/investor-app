import type { ComponentProps } from 'react';
import { controlAttributes, useFieldControl } from './Field';
import { ariaInvalid } from './Input';
import styles from './Textarea.module.css';

export type TextareaProps = ComponentProps<'textarea'> & {
  /**
   * Marks the textarea invalid outside a Field (any message, or true); inside one, the Field's
   * error does it and shows the message.
   */
  error?: string | boolean | null | undefined;
};

/**
 * A multi-line text input that grows by hand (vertical resize); a `ref` reaches the
 * `<textarea>`. Inside a Field it takes the Field's id, description and validity.
 */
export function Textarea({
  error,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...rest
}: TextareaProps) {
  const field = useFieldControl();
  return (
    <textarea
      {...rest}
      {...controlAttributes(field, {
        id,
        describedBy,
        invalid: Boolean(error) || ariaInvalid(invalid),
      })}
      className={[styles.textarea, className].filter(Boolean).join(' ')}
    />
  );
}
