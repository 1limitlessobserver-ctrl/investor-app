import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LockScreen, type LockScreenProps } from './LockScreen';

const brand = { name: 'Northwind Wealth', logoDataUrl: null };

function renderLock(props: Partial<LockScreenProps> = {}) {
  const handlers = { onUnlock: vi.fn(), onPasscode: vi.fn(), onSignOut: vi.fn() };
  const view = render(<LockScreen method="passcode" brand={brand} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

describe('LockScreen', () => {
  it('names itself Locked, shows the brand and waits in the passcode', () => {
    renderLock();
    expect(screen.getByRole('heading', { level: 1, name: 'Locked' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Locked' })).toHaveTextContent('Northwind Wealth');
    expect(screen.getByLabelText('Passcode')).toHaveFocus();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hands over the six digits on Unlock and clears the boxes for another try', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderLock();
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onPasscode).toHaveBeenCalledWith('246810');
    expect(screen.getByLabelText<HTMLInputElement>('Passcode').value).toBe('');
    expect(screen.getByLabelText('Passcode')).toHaveFocus();
  });

  it('takes a passcode filled in at once and submitted with Enter', async () => {
    const { onPasscode } = renderLock();
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: '000000' } });
    await userEvent.setup().keyboard('{Enter}');
    expect(onPasscode).toHaveBeenCalledWith('000000');
  });

  it('asks for every digit instead of sending a short passcode', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderLock();
    await user.type(screen.getByLabelText('Passcode'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onPasscode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');
  });

  it('says how many attempts are left after a wrong passcode', () => {
    const { rerender, onUnlock, onPasscode, onSignOut } = renderLock({ attemptsLeft: 4 });
    expect(screen.getByRole('alert')).toHaveTextContent('4 attempts left');
    expect(screen.getByLabelText('Passcode')).toHaveAttribute('aria-invalid', 'true');
    rerender(
      <LockScreen
        method="passcode"
        brand={brand}
        attemptsLeft={1}
        onUnlock={onUnlock}
        onPasscode={onPasscode}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('1 attempt left');
  });

  it('shows a check that could not run, and ignores presses while one runs', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderLock({
      error: 'The lock could not be checked. Try again.',
      busy: true,
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('The lock could not be checked.');
    const unlock = screen.getByRole('button', { name: 'Unlock' });
    expect(unlock).toHaveAttribute('aria-busy', 'true');
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.click(unlock);
    expect(onPasscode).not.toHaveBeenCalled();
  });

  it('unlocks with the device in the tap, and offers Try again after a failure', async () => {
    const user = userEvent.setup();
    const { onUnlock, rerender, onPasscode, onSignOut } = renderLock({ method: 'webauthn' });
    expect(screen.queryByLabelText('Passcode')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);

    rerender(
      <LockScreen
        method="webauthn"
        brand={brand}
        error="That didn't unlock the app."
        onUnlock={onUnlock}
        onPasscode={onPasscode}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("That didn't unlock the app.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onUnlock).toHaveBeenCalledTimes(2);
  });

  it('offers to sign out instead', async () => {
    const { onSignOut } = renderLock({ method: 'webauthn', brand: null });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
