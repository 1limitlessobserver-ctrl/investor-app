import { useState } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
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
  /**
   * A check is running: Unlock shows it and ignores presses, and the last error steps aside until
   * the check answers.
   */
  busy?: boolean | undefined;
  /**
   * What went wrong, as the screen's one alert: a cancelled or failed device prompt (Unlock then
   * reads "Try again"), or a check that could not run. It wins over `attemptsLeft`. Each try makes
   * it a new alert, so the same message coming back is announced again.
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
  // Presses so far: each one's message is a new alert, so the same failure is heard again.
  const [tries, setTries] = useState(0);
  return (
    <div className={styles.unlock}>
      <p className={styles.lead}>Unlock with your face, fingerprint or device PIN.</p>
      {error && !busy && (
        <p key={tries} className={styles.alert} role="alert">
          {error}
        </p>
      )}
      <Button
        size="lg"
        loading={busy}
        onClick={() => {
          setTries((count) => count + 1);
          onUnlock();
        }}
      >
        {error ? 'Try again' : 'Unlock'}
      </Button>
    </div>
  );
}

/**
 * The lock: the top modal layer, a dialog named by its `<h1>Locked</h1>` that covers the whole app
 * (opaque, so nothing behind it shows). It holds the brand, the way to unlock (the device prompt,
 * or the passcode labelled "Passcode") and "Sign out instead". Over anything already open (a
 * Sheet, a Dialog) it takes focus (the passcode box, or Unlock), keeps Tab inside, hides the rest
 * from assistive technology and stops the page scrolling. Escape and presses outside do nothing.
 * Render it once, at the app's root, outside the shell frame, while the app is locked.
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
  const passcodeError =
    error ??
    (attemptsLeft !== undefined && attemptsLeft > 0
      ? attemptsLeftMessage(attemptsLeft)
      : undefined);

  return (
    <RadixDialog.Root open modal>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.backdrop} />
        <RadixDialog.Content
          className={styles.screen}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
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
            <RadixDialog.Title asChild>
              <h1 className={styles.title}>Locked</h1>
            </RadixDialog.Title>
            {brand && <p className={styles.company}>{brand.name}</p>}
            {method === 'passcode' ? (
              <PasscodeForm
                className={styles.unlock}
                submitLabel="Unlock"
                busy={busy}
                error={passcodeError}
                onPasscode={onPasscode}
              />
            ) : (
              <DeviceUnlock busy={busy} error={error} onUnlock={onUnlock} />
            )}
            <Button variant="ghost" onClick={onSignOut}>
              Sign out instead
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
