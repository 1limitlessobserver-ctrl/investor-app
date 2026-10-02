import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmSheet, type ConfirmSheetProps } from './ConfirmSheet';

function renderConfirm(props: Partial<ConfirmSheetProps> = {}) {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn() };
  const view = render(
    <ConfirmSheet open reason="Send $10.00 to $grace" {...handlers} {...props} />,
  );
  return { ...handlers, ...view };
}

describe('ConfirmSheet', () => {
  it('is a dialog named Confirm that shows the reason and resolves with Confirm', async () => {
    const { onConfirm, onCancel } = renderConfirm();
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toHaveTextContent('Send $10.00 to $grace');
    expect(dialog).toHaveAccessibleDescription('Send $10.00 to $grace');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the amount formatted in its currency, and reads it before the reason', () => {
    renderConfirm({ reason: 'Invest in Solar Yield', amountCents: 123456, currency: 'EUR' });
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toHaveTextContent('€1,234.56');
    expect(dialog).toHaveAccessibleDescription('€1,234.56 Invest in Solar Yield');
  });

  it.each([
    ['no lock', {}],
    ['the device prompt', { method: 'webauthn' as const }],
    ['an offer to set up a lock', { needsSetup: true, onSetUpLock: () => {} }],
  ])('starts on Cancel with %s, so a held Enter never confirms', async (_, props) => {
    const { onConfirm, onCancel } = renderConfirm({ amountCents: 100000, ...props });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('starts in the code boxes when the lock is a passcode', () => {
    renderConfirm({ method: 'passcode' });
    expect(screen.getByLabelText('Passcode')).toHaveFocus();
  });

  it('resolves with Cancel on a press outside the sheet', async () => {
    const { onCancel, onConfirm } = renderConfirm();
    const overlay = document.querySelector('.overlay');
    if (!(overlay instanceof HTMLElement)) throw new Error('The sheet has no overlay.');
    // Radix starts listening for presses outside on the next task after opening.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await userEvent.setup().click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('resolves with Cancel, Escape, and never while closed', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm, rerender } = renderConfirm();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);

    rerender(
      <ConfirmSheet open={false} reason="Send $10.00" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says the device will ask when the lock is the device prompt', async () => {
    const { onConfirm } = renderConfirm({ method: 'webauthn' });
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toHaveTextContent(
      "You'll be asked for your face, fingerprint or device PIN.",
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith();
  });

  it('takes the passcode when the lock is a passcode, and wants all six digits', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderConfirm({ method: 'passcode' });
    await user.type(screen.getByLabelText('Passcode'), '1234');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');

    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: '246810' } });
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('246810');
  });

  it('says how many attempts are left, or what went wrong', () => {
    const { rerender, onConfirm, onCancel } = renderConfirm({
      method: 'passcode',
      attemptsLeft: 4,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('4 attempts left');
    rerender(
      <ConfirmSheet
        open
        reason="Send $10.00 to $grace"
        method="webauthn"
        error="That didn't confirm it. Try again."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("That didn't confirm it.");
  });

  it('offers to set up a lock first, and still confirms plainly', async () => {
    const user = userEvent.setup();
    const onSetUpLock = vi.fn();
    const { onConfirm } = renderConfirm({ needsSetup: true, onSetUpLock });
    await user.click(screen.getByRole('button', { name: 'Set up the lock' }));
    expect(onSetUpLock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith();
  });

  it('ignores Confirm while a check runs, but can always be cancelled', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirm({ method: 'webauthn', busy: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
