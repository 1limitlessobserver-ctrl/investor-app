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

  it('shows one error at a time', async () => {
    const user = userEvent.setup();
    render(
      <PasscodeForm submitLabel="Unlock" onPasscode={vi.fn()} error="Wrong passcode.">
        <Button variant="ghost">Cancel</Button>
      </PasscodeForm>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong passcode.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode'), '24');
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');
  });

  it('announces the same message again after each try', async () => {
    const user = userEvent.setup();
    const onPasscode = vi.fn();
    render(<PasscodeForm submitLabel="Unlock" onPasscode={onPasscode} error="Wrong passcode." />);
    const wrong = screen.getByRole('alert');
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.keyboard('{Enter}');
    expect(onPasscode).toHaveBeenCalledWith('246810');
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong passcode.');
    expect(screen.getByRole('alert')).not.toBe(wrong);

    await user.type(screen.getByLabelText('Passcode'), '24');
    await user.keyboard('{Enter}');
    const short = screen.getByRole('alert');
    expect(short).toHaveTextContent('Enter all six digits.');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');
    expect(screen.getByRole('alert')).not.toBe(short);
  });

  it('holds while busy: nothing is handed over and the last error steps aside', async () => {
    const user = userEvent.setup();
    const onPasscode = vi.fn();
    const form = (busy: boolean) => (
      <PasscodeForm
        submitLabel="Unlock"
        onPasscode={onPasscode}
        busy={busy}
        error="Wrong passcode."
      />
    );
    const { rerender } = render(form(true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock' })).toHaveAttribute('aria-busy', 'true');
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.keyboard('{Enter}');
    expect(onPasscode).not.toHaveBeenCalled();

    rerender(form(false));
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong passcode.');
  });
});
