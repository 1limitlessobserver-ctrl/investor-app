import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './form/Button';
import { Field } from './form/Field';
import { PinInput } from './form/PinInput';
import { INCOMPLETE_PASSCODE, PASSCODE_LENGTH } from './lockMessages';
import styles from './PasscodeForm.module.css';

export interface PasscodeFormProps {
  /** The submit button's words: "Unlock" or "Confirm". */
  submitLabel: string;
  /**
   * A check is running: the submit button shows it, nothing is handed over, and the last error
   * steps aside until the check answers.
   */
  busy?: boolean | undefined;
  /**
   * Why the last passcode did not work, shown under the boxes as the one alert. Each try makes it
   * a new alert, so the same message coming back is announced again.
   */
  error?: string | undefined;
  /** The six digits, on the submit button or Enter. The boxes then clear for another try. */
  onPasscode: (code: string) => void;
  /** More buttons under the submit button (Cancel). */
  children?: ReactNode;
  className?: string | undefined;
}

/**
 * The device lock's passcode: six masked boxes labelled "Passcode" and a submit button. A short
 * passcode is not handed over; the form asks for all six digits instead.
 */
export function PasscodeForm({
  submitLabel,
  busy = false,
  error,
  onPasscode,
  children,
  className,
}: PasscodeFormProps) {
  const [code, setCode] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  // Submits so far: each one's message is a new alert.
  const [tries, setTries] = useState(0);
  const firstBox = useRef<HTMLInputElement | null>(null);

  function change(next: string) {
    setCode(next);
    setIncomplete(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setTries((count) => count + 1);
    if (code.length < PASSCODE_LENGTH) {
      setIncomplete(true);
      firstBox.current?.focus();
      return;
    }
    onPasscode(code);
    setCode('');
    firstBox.current?.focus();
  }

  return (
    <form
      className={[styles.form, className].filter(Boolean).join(' ')}
      onSubmit={submit}
      noValidate
    >
      <Field
        label="Passcode"
        error={incomplete ? INCOMPLETE_PASSCODE : busy ? undefined : error}
        errorKey={tries}
      >
        <PinInput length={PASSCODE_LENGTH} mask value={code} onChange={change} ref={firstBox} />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" size="lg" loading={busy}>
          {submitLabel}
        </Button>
        {children}
      </div>
    </form>
  );
}
