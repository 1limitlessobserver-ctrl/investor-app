import { useEffect, useId, useRef } from 'react';
import type { LockMethod } from '../platform/types';
import { BrandMark, type BrandIdentity } from './BrandMark';
import { Button } from './form/Button';
import { attemptsLeftMessage } from './lockMessages';
import { Orb } from './Orb';
import { PasscodeForm } from './PasscodeForm';
import styles from './LockScreen.module.css';

export interface LockScreenProps {
  /** How this device unlocks: the operating system's prompt, or the six-digit passcode. */
  method: LockMethod;
  /** The company's mark and name; null when the brand is not known yet. */
  brand: BrandIdentity | null;
  /** A check is running: Unlock shows it and ignores presses. */
  busy?: boolean | undefined;
  /**
   * What went wrong, as the screen's one alert: a cancelled or failed device prompt (Unlock then
   * reads "Try again"), or a check that could not run. It wins over `attemptsLeft`.
   */
  error?: string | undefined;
  /** After a wrong passcode, the tries left: "That passcode didn't match. 4 attempts left." */
  attemptsLeft?: number | undefined;
  /**
   * The device prompt's Unlock (or Try again) was pressed. It runs inside the tap, so call
   * `platform.lock.verify()` straight from here.
   */
  onUnlock: () => void;
  /** The six digits, on Unlock or Enter; the boxes clear for another try. */
  onPasscode: (code: string) => void;
  /** "Sign out instead". */
  onSignOut: () => void;
}

function DeviceUnlock({
  busy,
  error,
  onUnlock,
}: Pick<LockScreenProps, 'busy' | 'error' | 'onUnlock'>) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <div className={styles.unlock}>
      <p className={styles.lead}>Unlock with your face, fingerprint or device PIN.</p>
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
      <Button ref={button} size="lg" loading={busy} onClick={onUnlock}>
        {error ? 'Try again' : 'Unlock'}
      </Button>
    </div>
  );
}

/**
 * The lock overlay: covers the whole app (opaque, so nothing behind it shows) with the brand, the
 * heading "Locked", the way to unlock (the device prompt, or the passcode labelled "Passcode")
 * and "Sign out instead". Focus moves into it when it appears; make the app behind it `inert`.
 */
export function LockScreen({
  method,
  brand,
  busy = false,
  error,
  attemptsLeft,
  onUnlock,
  onPasscode,
  onSignOut,
}: LockScreenProps) {
  const headingId = useId();
  const passcodeError =
    error ??
    (attemptsLeft !== undefined && attemptsLeft > 0
      ? attemptsLeftMessage(attemptsLeft)
      : undefined);

  return (
    <section className={styles.screen} aria-labelledby={headingId}>
      <div className={styles.content}>
        <div className={styles.emblem} aria-hidden="true">
          {brand ? (
            <BrandMark
              name={brand.name}
              logoDataUrl={brand.logoDataUrl}
              size="lg"
              showName={false}
            />
          ) : (
            <Orb size="lg" tone="glass" />
          )}
        </div>
        <h1 id={headingId} className={styles.title}>
          Locked
        </h1>
        {brand && <p className={styles.company}>{brand.name}</p>}
        {method === 'passcode' ? (
          <PasscodeForm
            className={styles.unlock}
            submitLabel="Unlock"
            busy={busy}
            error={passcodeError}
            onPasscode={onPasscode}
            focusOnMount
          />
        ) : (
          <DeviceUnlock busy={busy} error={error} onUnlock={onUnlock} />
        )}
        <Button variant="ghost" onClick={onSignOut}>
          Sign out instead
        </Button>
      </div>
    </section>
  );
}
