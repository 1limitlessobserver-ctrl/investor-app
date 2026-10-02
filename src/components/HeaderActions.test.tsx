import { join } from 'node:path';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cssRule, rem } from '../test/cssRules';
import { renderInRouter } from '../test/renderInRouter';
import { HeaderActions } from './HeaderActions';

describe('HeaderActions', () => {
  it('links the bell to Alerts with the unread count in its name and badge', () => {
    const { container } = renderInRouter(<HeaderActions unread={3} />);
    const bell = screen.getByRole('link', { name: 'Alerts, 3 unread' });
    expect(bell).toHaveAttribute('href', '/alerts');
    const badge = container.querySelector('[data-badge]');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no badge with nothing unread and caps a long count', () => {
    const { container, unmount } = renderInRouter(<HeaderActions unread={0} />);
    expect(screen.getByRole('link', { name: 'Alerts, 0 unread' })).toBeInTheDocument();
    expect(container.querySelector('[data-badge]')).toBeNull();
    unmount();

    renderInRouter(<HeaderActions unread={250} />);
    expect(screen.getByRole('link', { name: 'Alerts, 250 unread' })).toHaveTextContent('99+');
  });

  it('opens the Oracle from the orb and marks the screen it is on', async () => {
    const { router } = renderInRouter(<HeaderActions unread={1} />, '/alerts');
    expect(screen.getByRole('link', { name: 'Alerts, 1 unread' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.setup().click(screen.getByRole('link', { name: 'Oracle' }));
    expect(router.state.location.pathname).toBe('/oracle');
    expect(screen.getByRole('link', { name: 'Oracle' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps 44 px targets', () => {
    const rule = cssRule(join(import.meta.dirname, 'HeaderActions.module.css'), '.action');
    expect(rem(rule['min-width'])).toBeGreaterThanOrEqual(2.75);
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
  });
});
