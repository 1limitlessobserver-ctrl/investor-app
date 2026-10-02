import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusBanners } from './StatusBanners';

describe('StatusBanners', () => {
  it('keeps its live regions empty while online and up to date', () => {
    render(<StatusBanners online />);
    expect(screen.getByRole('status', { name: 'Connection' })).toBeEmptyDOMElement();
    expect(screen.getByRole('status', { name: 'Update' })).toBeEmptyDOMElement();
  });

  it('says the app is offline and that balances are hidden', () => {
    render(<StatusBanners online={false} />);
    expect(screen.getByRole('status', { name: 'Connection' })).toHaveTextContent(
      "You're offline. Balances are hidden until you reconnect.",
    );
  });

  it('offers to reload when a new version is ready', async () => {
    const onReload = vi.fn();
    const { rerender } = render(<StatusBanners online updateReady onReload={onReload} />);
    expect(screen.getByRole('status', { name: 'Update' })).toHaveTextContent('Update available');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);

    rerender(<StatusBanners online updateReady={false} onReload={onReload} />);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});
