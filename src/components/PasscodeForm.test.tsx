import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './form/Button';
import { PasscodeForm } from './PasscodeForm';

describe('PasscodeForm', () => {
  it('collects six masked digits and hands them over on submit, then clears', async () => {
    const user = userEvent.setup();
    const onPasscode = vi.fn();
    render(<PasscodeForm submitLabel="Unlock" onPasscode={onPasscode} />);
    const first = screen.getByLabelText<HTMLInputElement>('Passcode');
    expect(first).toHaveAttribute('type', 'password');
    await user.type(first, '246810');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onPasscode).toHaveBeenCalledWith('246810');
    expect(first.value).toBe('');
    expect(first).toHaveFocus();
  });

  it('asks for all six digits before handing anything over', async () => {
    const user = userEvent.setup();
    const onPasscode = vi.fn();
    render(<PasscodeForm submitLabel="Confirm" onPasscode={onPasscode} />);
    await user.type(screen.getByLabelText('Passcode'), '24');
    await user.keyboard('{Enter}');
    expect(onPasscode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');
    await user.keyboard('6');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows one error at a time and holds while busy', async () => {
    const user = userEvent.setup();
    const onPasscode = vi.fn();
    render(
      <PasscodeForm submitLabel="Unlock" onPasscode={onPasscode} busy error="Wrong passcode.">
        <Button variant="ghost">Cancel</Button>
      </PasscodeForm>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong passcode.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.keyboard('{Enter}');
    expect(onPasscode).not.toHaveBeenCalled();
  });
});
