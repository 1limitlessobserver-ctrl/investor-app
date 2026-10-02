import { describe, expect, it } from 'vitest';
import { attemptsLeftMessage, INCOMPLETE_PASSCODE } from './lockMessages';

describe('lockMessages', () => {
  it('says how many passcode attempts are left, in the singular for one', () => {
    expect(attemptsLeftMessage(4)).toBe("That passcode didn't match. 4 attempts left.");
    expect(attemptsLeftMessage(1)).toBe("That passcode didn't match. 1 attempt left.");
  });

  it('asks for every digit of a short passcode', () => {
    expect(INCOMPLETE_PASSCODE).toBe('Enter all six digits.');
  });
});
