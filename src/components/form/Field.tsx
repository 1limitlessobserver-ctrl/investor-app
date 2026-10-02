import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import styles from './Field.module.css';

/** What a Field tells the control inside it. */
export interface FieldControl {
  /** The control's id, which the label's `htmlFor` names. */
  id: string;
  /** The label's id, for controls a `<label>` cannot name (a slider thumb). */
  labelId: string;
  /** The hint's and error's ids, or undefined when there is neither. */
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** The surrounding Field's wiring, or null outside one. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

/**
 * The attributes a control puts on its focusable element: inside a Field its id and description
 * come from the Field (a description the control brings is kept after the Field's), and an error
 * on either marks it invalid.
 */
export function controlAttributes(
  field: FieldControl | null,
  own: { id?: string | undefined; describedBy?: string | undefined; invalid?: boolean | undefined },
): {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
} {
  const describedBy = [field?.describedBy, own.describedBy].filter(Boolean).join(' ');
  return {
    id: field?.id ?? own.id,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': own.invalid || field?.invalid ? true : undefined,
  };
}

export interface FieldProps {
  label: ReactNode;
  /** Help shown under the label and read with the control. */
  hint?: ReactNode;
  /** A message that marks the control invalid and is announced; null or '' for none. */
  error?: ReactNode;
  /** The control's id; one is made up when it is left out. Set it here, not on the control. */
  id?: string | undefined;
  /** Label and control on one row (a Switch), hint and error below. */
  inline?: boolean;
  className?: string | undefined;
  /** One control: Input, Textarea, Select's trigger, Switch, Slider or PinInput. */
  children: ReactNode;
}

/**
 * A labelled form field. It names its control with the label and describes it with the hint and
 * error (`aria-describedby`, `aria-invalid`); the controls in this folder pick that up on their
 * own. The error is a `role="alert"`, so a screen should not show the same message in another
 * alert.
 */
export function Field({ label, hint, error, id, inline = false, className, children }: FieldProps) {
  const base = useId();
  const hasHint = hint !== undefined && hint !== null && hint !== '';
  const hasError = error !== undefined && error !== null && error !== '' && error !== false;
  const controlId = id ?? `${base}control`;
  const labelId = `${base}label`;
  const hintId = `${base}hint`;
  const errorId = `${base}error`;

  const control = useMemo<FieldControl>(() => {
    const describedBy = [hasHint ? hintId : '', hasError ? errorId : ''].filter(Boolean).join(' ');
    return {
      id: controlId,
      labelId,
      describedBy: describedBy === '' ? undefined : describedBy,
      invalid: hasError,
    };
  }, [controlId, labelId, hintId, errorId, hasHint, hasError]);

  return (
    <div className={[styles.field, inline && styles.inline, className].filter(Boolean).join(' ')}>
      <label id={labelId} htmlFor={controlId} className={styles.label}>
        {label}
      </label>
      {hasHint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <div className={styles.control}>
        <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      </div>
      {hasError && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
