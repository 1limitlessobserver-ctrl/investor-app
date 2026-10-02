import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cssRule, rem } from '../test/cssRules';
import { renderInRouter } from '../test/renderInRouter';
import { TabBar } from './TabBar';

function links() {
  return within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
}

describe('TabBar', () => {
  it('links the five destinations in order, Move in the middle', () => {
    renderInRouter(<TabBar />);
    expect(links().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Portfolio', '/portfolio'],
      ['Move', '/move'],
      ['Legacy', '/legacy'],
      ['Profile', '/profile'],
    ]);
  });

  it('marks only the destination of the current route', () => {
    renderInRouter(<TabBar />, '/portfolio');
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('aria-current', 'page');
    expect(links().filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('keeps Home for the root alone and Move for its flows', async () => {
    const { router } = renderInRouter(<TabBar />, '/move/deposit');
    expect(screen.getByRole('link', { name: 'Move' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    await userEvent.setup().click(screen.getByRole('link', { name: 'Home' }));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps 44 px targets', () => {
    const css = join(import.meta.dirname, 'TabBar.module.css');
    for (const selector of ['.tab', '.move']) {
      expect(rem(cssRule(css, selector)['min-width'])).toBeGreaterThanOrEqual(2.75);
      expect(rem(cssRule(css, selector)['min-height'])).toBeGreaterThanOrEqual(2.75);
    }
  });
});
