import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LockMethod } from '../../platform/types';
import { LockSetupSheet } from './LockSetupSheet';

function renderSheet(available: LockMethod, extra: { busy?: boolean; error?: string } = {}) {
  const props = {
    onUseDevice: vi.fn(),
    onPasscode: vi.fn(),
    onNotNow: vi.fn(),
  };
  render(
    <LockSetupSheet open available={available} email="ada@example.com" {...extra} {...props} />,
  );
  return props;
}

describe('LockSetupSheet', () => {
  it('offers the device’s own lock where it has one, or a passcode', async () => {
    const user = userEvent.setup();
    const { onUseDevice } = renderSheet('webauthn');
    expect(screen.getByRole('dialog', { name: 'Lock the app on this device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Use Face ID / Touch ID / Windows Hello' }),
    );
    expect(onUseDevice).toHaveBeenCalledTimes(1);
  });

  it('keeps the device’s own lock waiting until the investor’s email can name it', async () => {
    const user = userEvent.setup();
    const handlers = { onUseDevice: vi.fn(), onPasscode: vi.fn(), onNotNow: vi.fn() };
    const { rerender } = render(<LockSetupSheet open available="webauthn" {...handlers} />);
    const device = screen.getByRole('button', { name: 'Use Face ID / Touch ID / Windows Hello' });
    expect(device).toHaveAttribute('aria-busy', 'true');
    await user.click(device);
    expect(handlers.onUseDevice).not.toHaveBeenCalled();
    rerender(<LockSetupSheet open available="webauthn" email="ada@example.com" {...handlers} />);
    expect(device).not.toHaveAttribute('aria-busy');
    await user.click(device);
    expect(handlers.onUseDevice).toHaveBeenCalledTimes(1);
  });

  it('offers only a passcode where the device has no lock of its own', () => {
    renderSheet('passcode');
    expect(screen.getByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Face ID/ })).toBeNull();
  });

  it('takes a passcode typed twice, one field at a time', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderSheet('passcode');
    await user.click(screen.getByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    const repeat = await screen.findByLabelText('Repeat passcode');
    expect(screen.queryByLabelText('Passcode')).toBeNull();
    expect(repeat).toHaveFocus();
    await user.type(repeat, '246810');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    expect(onPasscode).toHaveBeenCalledWith('246810');
  });

  it('starts again when the two passcodes differ', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderSheet('passcode');
    await user.click(screen.getByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '135790');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    expect(onPasscode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("Those passcodes didn't match.");
    expect(screen.getByLabelText('Passcode')).toHaveFocus();
  });

  it('asks for all six digits before saving', async () => {
    const user = userEvent.setup();
    const { onPasscode } = renderSheet('passcode');
    await user.click(screen.getByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '246');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    expect(onPasscode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits.');
  });

  it('lets the investor decide later, with Not now or Escape', async () => {
    const user = userEvent.setup();
    const { onNotNow } = renderSheet('webauthn');
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onNotNow).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onNotNow).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the device’s own lock', 'webauthn' as const, false],
    ['a passcode', 'passcode' as const, true],
  ])(
    'waits while %s is set up: no Not now, Escape or press outside',
    async (_, available, typed) => {
      const user = userEvent.setup();
      const handlers = { onUseDevice: vi.fn(), onPasscode: vi.fn(), onNotNow: vi.fn() };
      const { rerender } = render(<LockSetupSheet open available={available} {...handlers} />);
      if (typed) {
        await user.click(screen.getByRole('button', { name: 'Set a passcode' }));
        await user.type(screen.getByLabelText('Passcode'), '246810');
        await user.type(await screen.findByLabelText('Repeat passcode'), '246810');
        await user.click(screen.getByRole('button', { name: 'Save passcode' }));
        expect(handlers.onPasscode).toHaveBeenCalledWith('246810');
      }
      rerender(<LockSetupSheet open available={available} busy {...handlers} />);
      const notNow = screen.getByRole('button', { name: 'Not now' });
      expect(notNow).toHaveAttribute('aria-disabled', 'true');
      await user.click(notNow);
      await user.keyboard('{Escape}');
      const overlay = document.querySelector('.overlay');
      if (!(overlay instanceof HTMLElement)) throw new Error('The sheet has no overlay.');
      await new Promise((resolve) => setTimeout(resolve, 0)); // Radix listens from the next task
      await user.click(overlay);
      expect(handlers.onNotNow).not.toHaveBeenCalled();
    },
  );

  it('shows why the last try did not work, as its one alert', () => {
    renderSheet('passcode', { error: "The passcode couldn't be saved on this device. Try again." });
    expect(screen.getByRole('alert')).toHaveTextContent("couldn't be saved");
  });
});
