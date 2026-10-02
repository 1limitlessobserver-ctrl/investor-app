import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/form/Button';
import { Field } from '../../components/form/Field';
import { PinInput } from '../../components/form/PinInput';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/form/Sheet';
import { INCOMPLETE_PASSCODE, PASSCODE_LENGTH } from '../../components/lockMessages';
import type { LockMethod } from '../../platform/types';
import styles from './LockSetupSheet.module.css';

export interface LockSetupSheetProps {
  open: boolean;
  /** What this device offers: its own lock (face, fingerprint, device PIN) or a passcode only. */
  available: LockMethod;
  /**
   * A setup is under way: its button shows it and ignores presses, and so do "Not now", Escape and
   * a press outside, until the setup answers.
   */
  busy?: boolean | undefined;
  /** Why the last try did not work, as the sheet's one alert. */
  error?: string | undefined;
  /** "Use Face ID / Touch ID / Windows Hello", in the tap: the browser's prompt needs it. */
  onUseDevice: () => void;
  /** The six digits, typed twice alike. */
  onPasscode: (code: string) => void;
  /** "Not now", Escape or a press outside: no lock for now. Never while `busy`. */
  onNotNow: () => void;
}

const MISMATCH = "Those passcodes didn't match. Choose one again.";

type Step =
  { name: 'choose' } | { name: 'passcode'; mismatch: boolean } | { name: 'repeat'; first: string };

/**
 * The offer to lock the app on this device, after a first sign-in and wherever a lock is wanted
 * and none is set up: the device's own lock where it has one, or a six-digit passcode, typed and
 * then repeated (one field at a time), or "Not now".
 */
export function LockSetupSheet({
  open,
  available,
  busy = false,
  error,
  onUseDevice,
  onPasscode,
  onNotNow,
}: LockSetupSheetProps) {
  const notNowUnlessBusy = () => {
    if (!busy) onNotNow();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) notNowUnlessBusy();
      }}
    >
      <SheetContent closeButton={false} className={styles.sheet}>
        <SheetHeader>
          <SheetTitle>Lock the app on this device</SheetTitle>
          <SheetDescription>
            Ask for your face, fingerprint or a passcode when the app opens and after five minutes
            away.
          </SheetDescription>
        </SheetHeader>
        <Steps
          available={available}
          busy={busy}
          error={error}
          onUseDevice={onUseDevice}
          onPasscode={onPasscode}
          onNotNow={notNowUnlessBusy}
        />
      </SheetContent>
    </Sheet>
  );
}

/** The sheet's body; it starts afresh at "choose" each time the sheet opens. */
function Steps({
  available,
  busy,
  error,
  onUseDevice,
  onPasscode,
  onNotNow,
}: Omit<LockSetupSheetProps, 'open'> & { busy: boolean }) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [code, setCode] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  // Submits so far: a repeated message is a new alert.
  const [tries, setTries] = useState(0);
  const firstBox = useRef<HTMLInputElement | null>(null);

  // A new field takes focus from the button or field that went away.
  useEffect(() => {
    if (step.name !== 'choose') firstBox.current?.focus();
  }, [step]);

  const notNow = (
    <Button variant="ghost" aria-disabled={busy || undefined} onClick={onNotNow}>
      Not now
    </Button>
  );
  const shown = busy ? undefined : error;

  if (step.name === 'choose') {
    return (
      <div className={styles.actions}>
        {shown && (
          <p className={styles.alert} role="alert">
            {shown}
          </p>
        )}
        {available === 'webauthn' && (
          <Button size="lg" loading={busy} onClick={onUseDevice}>
            Use Face ID / Touch ID / Windows Hello
          </Button>
        )}
        <Button
          size="lg"
          variant={available === 'webauthn' ? 'outline' : 'primary'}
          onClick={() => setStep({ name: 'passcode', mismatch: false })}
        >
          Set a passcode
        </Button>
        {notNow}
      </div>
    );
  }

  if (step.name === 'passcode') {
    return (
      <div className={styles.form}>
        <Field
          label="Passcode"
          hint="Six digits you'll remember."
          error={step.mismatch ? MISMATCH : undefined}
        >
          <PinInput
            length={PASSCODE_LENGTH}
            mask
            ref={firstBox}
            onComplete={(first) => {
              setCode('');
              setIncomplete(false);
              setStep({ name: 'repeat', first });
            }}
          />
        </Field>
        <div className={styles.actions}>{notNow}</div>
      </div>
    );
  }

  const { first } = step;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setTries((count) => count + 1);
    if (code.length < PASSCODE_LENGTH) {
      setIncomplete(true);
      firstBox.current?.focus();
      return;
    }
    if (code !== first) {
      setStep({ name: 'passcode', mismatch: true });
      return;
    }
    onPasscode(code);
  }

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <Field
        label="Repeat passcode"
        error={incomplete ? INCOMPLETE_PASSCODE : shown}
        errorKey={tries}
      >
        <PinInput
          length={PASSCODE_LENGTH}
          mask
          value={code}
          ref={firstBox}
          onChange={(next) => {
            setCode(next);
            setIncomplete(false);
          }}
        />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" size="lg" loading={busy}>
          Save passcode
        </Button>
        {notNow}
      </div>
    </form>
  );
}
