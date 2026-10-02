// The device lock's words, shared by the lock screen and the confirmation sheet.

/** The device lock's passcode has six digits (platform.lock.enrollPasscode refuses others). */
export const PASSCODE_LENGTH = 6;

/** Shown when Unlock or Confirm is pressed before all six digits are in. */
export const INCOMPLETE_PASSCODE = 'Enter all six digits.';

/** After a wrong passcode, with the attempts platform.lock.verifyPasscode() says are left. */
export function attemptsLeftMessage(attemptsLeft: number): string {
  const attempts = attemptsLeft === 1 ? 'attempt' : 'attempts';
  return `That passcode didn't match. ${attemptsLeft} ${attempts} left.`;
}
