import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StateView } from './StateView';

describe('StateView', () => {
  it('shows skeleton lines in a status named Loading', () => {
    const { container, rerender } = render(<StateView kind="loading" />);
    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status).toHaveTextContent('Loading');
    expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(3);

    rerender(<StateView kind="loading" lines={5} title="Loading your statements" />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveTextContent(
      'Loading your statements',
    );
    expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(5);
  });

  it('invites the next step when empty', async () => {
    const onClick = vi.fn();
    render(
      <StateView
        kind="empty"
        title="No activity yet"
        detail="Deposits, maturities and withdrawals appear here as they happen."
        action={{ label: 'Make a deposit', onClick }}
      />,
    );
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Make a deposit' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('announces an error with what went wrong and a way to retry', async () => {
    const retry = vi.fn();
    render(
      <StateView
        kind="error"
        detail="The platform did not answer."
        action={{ label: 'Try again', onClick: retry }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("This didn't load");
    expect(alert).toHaveTextContent('The platform did not answer.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says calmly that it is offline', () => {
    render(<StateView kind="offline" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent("You're offline");
    expect(status).toHaveTextContent("This appears as soon as you're back online.");
  });

  it('has its own words for an empty list', () => {
    render(<StateView kind="empty" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('uses the words it is given over its own', () => {
    render(<StateView kind="error" title="Statements did not load" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Statements did not load');
    expect(screen.queryByText("This didn't load")).toBeNull();
  });
});
