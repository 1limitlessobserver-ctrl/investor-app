import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBanners } from './StatusBanners';

describe('StatusBanners', () => {
  it('keeps its live region empty while online', () => {
    render(<StatusBanners online />);
    expect(screen.getByRole('status', { name: 'Connection' })).toBeEmptyDOMElement();
  });

  it('leaves the offer of a new version to UpdateToast: one region, the connection', () => {
    render(<StatusBanners online={false} />);
    expect(screen.getAllByRole('status')).toEqual([
      screen.getByRole('status', { name: 'Connection' }),
    ]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the app is offline and that balances are hidden', () => {
    render(<StatusBanners online={false} />);
    expect(screen.getByRole('status', { name: 'Connection' })).toHaveTextContent(
      "You're offline. Balances are hidden until you reconnect.",
    );
  });
});
