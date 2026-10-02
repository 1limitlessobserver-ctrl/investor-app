import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './form/Button';
import { Field } from './form/Field';
import { PinInput } from './form/PinInput';
import { INCOMPLETE_PASSCODE, PASSCODE_LENGTH } from './lockMessages';
import styles from './PasscodeForm.module.css';

export interface PasscodeFormProps {
  /** The submit button's words: "Unlock" or "Confirm". */
  submitLabel: string;
  /** A check is running: the submit button shows it and nothing is handed over. */
  busy?: boolean | undefined;
  /** Why the last passcode did not work, shown under the boxes as the one alert. */
  error?: string | undefined;
  /** The six digits, on the submit button or Enter. The boxes then clear for another try. */
  onPasscode: (code: string) => void;
  /** Puts focus in the first box when the form appears. */
  focusOnMount?: boolean | undefined;
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
  focusOnMount = false,
  children,
  className,
}: PasscodeFormProps) {
  const [code, setCode] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const firstBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusOnMount) firstBox.current?.focus();
  }, [focusOnMount]);

  function change(next: string) {
    setCode(next);
    setIncomplete(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
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
      <Field label="Passcode" error={incomplete ? INCOMPLETE_PASSCODE : error}>
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
