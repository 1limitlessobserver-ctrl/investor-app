import { useId, useRef } from 'react';
import { format } from '../lib/format';
import type { LockMethod } from '../platform/types';
import { Button } from './form/Button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './form/Sheet';
import { attemptsLeftMessage } from './lockMessages';
import { PasscodeForm } from './PasscodeForm';
import styles from './ConfirmSheet.module.css';

export interface ConfirmSheetProps {
  open: boolean;
  /** What is being confirmed, in the investor's words: "Send $10.00 to $grace". */
  reason: string;
  /** The amount at stake in integer cents, shown large above the reason. */
  amountCents?: number | undefined;
  /** The amount's currency code; USD when left out. */
  currency?: string | undefined;
  /**
   * How Confirm proves it is the investor: 'webauthn' (the device's prompt, run by `onConfirm`),
   * 'passcode' (the sheet takes the six digits), or nothing (no lock set up: a plain Confirm).
   */
  method?: LockMethod | null | undefined;
  /** No device lock yet: the sheet suggests one, with "Set up the lock" (`onSetUpLock`). */
  needsSetup?: boolean | undefined;
  onSetUpLock?: (() => void) | undefined;
  /** A check is running: Confirm shows it and ignores presses; Cancel still works. */
  busy?: boolean | undefined;
  /** What went wrong, as the sheet's one alert. It wins over `attemptsLeft`. */
  error?: string | undefined;
  /** After a wrong passcode, the tries left. */
  attemptsLeft?: number | undefined;
  /**
   * Confirm was pressed: with the six digits when `method` is 'passcode', else with nothing. It
   * runs inside the tap, so `platform.lock.verify()` can be called straight from here.
   */
  onConfirm: (passcode?: string) => void;
  /** Cancel, Escape, or a press outside the sheet. */
  onCancel: () => void;
}

/**
 * The confirmation before every money action and account closure: a sheet (a dialog named
 * "Confirm", described by the amount and then the reason) with the way to prove it is the
 * investor, and "Confirm" and "Cancel". It opens with focus on Cancel, so a held Enter never
 * confirms, or in the code boxes when the lock is a passcode. The app shows it from `confirm()`
 * and settles that promise from the callbacks.
 */
export function ConfirmSheet({
  open,
  reason,
  amountCents,
  currency,
  method = null,
  needsSetup = false,
  onSetUpLock,
  busy = false,
  error,
  attemptsLeft,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const amountId = useId();
  const reasonId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const message =
    error ??
    (attemptsLeft !== undefined && attemptsLeft > 0
      ? attemptsLeftMessage(attemptsLeft)
      : undefined);
  const cancel = (
    <Button ref={cancelButton} variant="ghost" size="lg" onClick={onCancel}>
      Cancel
    </Button>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <SheetContent
        closeButton={false}
        className={styles.sheet}
        aria-describedby={amountCents === undefined ? reasonId : `${amountId} ${reasonId}`}
        onOpenAutoFocus={(event) => {
          if (method === 'passcode') return;
          event.preventDefault();
          cancelButton.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle className={styles.title}>Confirm</SheetTitle>
        </SheetHeader>
        {amountCents !== undefined && (
          <p id={amountId} className={styles.amount}>
            {format.money(amountCents, currency)}
          </p>
        )}
        <p id={reasonId} className={styles.reason}>
          {reason}
        </p>
        {needsSetup && (
          <div className={styles.setup}>
            <p className={styles.note}>
              Set up a device lock so confirmations like this one ask for your face, fingerprint or
              a passcode.
            </p>
            {onSetUpLock && (
              <Button variant="outline" onClick={onSetUpLock}>
                Set up the lock
              </Button>
            )}
          </div>
        )}
        {method === 'passcode' ? (
          <PasscodeForm
            submitLabel="Confirm"
            busy={busy}
            error={message}
            onPasscode={(code) => onConfirm(code)}
          >
            {cancel}
          </PasscodeForm>
        ) : (
          <div className={styles.actions}>
            {method === 'webauthn' && (
              <p className={styles.note}>
                You&apos;ll be asked for your face, fingerprint or device PIN.
              </p>
            )}
            {message && (
              <p className={styles.alert} role="alert">
                {message}
              </p>
            )}
            <Button size="lg" loading={busy} onClick={() => onConfirm()}>
              Confirm
            </Button>
            {cancel}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
