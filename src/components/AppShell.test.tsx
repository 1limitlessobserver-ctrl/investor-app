import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInRouter } from '../test/renderInRouter';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { AppShell } from './AppShell';

const brand = { name: 'Northwind Wealth', logoDataUrl: null };

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on phones: the brand, bell and orb on top, the screen, and the five tabs below', () => {
    renderInRouter(
      <AppShell brand={brand} unread={2} online>
        <h1>Home</h1>
      </AppShell>,
    );
    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Northwind Wealth');
    expect(within(header).getByRole('link', { name: 'Alerts, 2 unread' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Oracle' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Home' })).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(5);
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the offline banner when told', () => {
    renderInRouter(
      <AppShell brand={brand} unread={0} online={false}>
        <h1>Home</h1>
      </AppShell>,
    );
    expect(screen.getByRole('status', { name: 'Connection' })).toHaveTextContent("You're offline");
  });

  it('at 900 px and above: the rail of seven instead of tabs, bell and orb', () => {
    stubMatchMedia(true);
    renderInRouter(
      <AppShell brand={brand} unread={2} online>
        <h1>Portfolio</h1>
      </AppShell>,
      '/portfolio',
    );
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getAllByRole('link')).toHaveLength(7);
    expect(within(rail).getByRole('link', { name: 'Portfolio' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('link', { name: /^Alerts, \d+ unread$/ })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Oracle' })).toHaveLength(1);
    expect(screen.getByText('Northwind Wealth')).toBeInTheDocument();
  });

  it('waits for the brand without leaving a gap', () => {
    renderInRouter(
      <AppShell brand={null} unread={0} online>
        <h1>Home</h1>
      </AppShell>,
    );
    expect(screen.getByRole('banner')).not.toHaveTextContent('Northwind');
    expect(screen.getByRole('link', { name: 'Alerts, 0 unread' })).toBeInTheDocument();
  });
});
