import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const update = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: update,
  }),
}));
import { UpdateToast } from './UpdateToast';

describe('UpdateToast', () => {
  it('offers to reload when a new version is waiting', async () => {
    render(<UpdateToast />);
    expect(screen.getByRole('status')).toHaveTextContent('Update available');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(update).toHaveBeenCalledWith(true);
  });
});
