import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule, rem } from '../test/cssRules';
import { renderInRouter } from '../test/renderInRouter';
import { NavRail } from './NavRail';

function links() {
  return within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
}

describe('NavRail', () => {
  it('links the five destinations, then Alerts and the Oracle', () => {
    renderInRouter(<NavRail unread={2} />);
    expect(links().map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/portfolio',
      '/move',
      '/legacy',
      '/profile',
      '/alerts',
      '/oracle',
    ]);
    for (const name of ['Home', 'Portfolio', 'Move', 'Legacy', 'Profile', 'Oracle']) {
      expect(screen.getByRole('link', { name })).toHaveTextContent(name);
    }
  });

  it('names Alerts with the unread count and shows it as a badge', () => {
    const { container } = renderInRouter(<NavRail unread={2} />);
    expect(screen.getByRole('link', { name: 'Alerts, 2 unread' })).toHaveTextContent('Alerts');
    expect(container.querySelector('[data-badge]')).toHaveTextContent('2');
  });

  it('marks only the destination of the current route', () => {
    renderInRouter(<NavRail unread={0} />, '/legacy');
    expect(screen.getByRole('link', { name: 'Legacy' })).toHaveAttribute('aria-current', 'page');
    expect(links().filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('keeps 44 px targets', () => {
    const rule = cssRule(join(import.meta.dirname, 'NavRail.module.css'), '.link');
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
  });
});
