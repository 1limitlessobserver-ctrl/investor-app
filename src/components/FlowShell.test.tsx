import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInRouter } from '../test/renderInRouter';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { FlowShell } from './FlowShell';
import { Button } from './form/Button';

const brand = { name: 'Northwind Wealth', logoDataUrl: null };

describe('FlowShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on phones: back, title, actions, bell and orb, and no tab bar', async () => {
    const onBack = vi.fn();
    renderInRouter(
      <FlowShell
        brand={brand}
        unread={1}
        online
        title="Deposit"
        onBack={onBack}
        actions={<Button size="sm">Help</Button>}
      >
        <p>Methods</p>
      </FlowShell>,
      '/move/deposit',
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'Deposit' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Help' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Alerts, 1 unread' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Oracle' })).toBeInTheDocument();
    // The title sits in the header bar, so it names the main landmark too.
    expect(screen.getByRole('main', { name: 'Deposit' })).toHaveTextContent('Methods');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    await userEvent.setup().click(within(header).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the offline banner', () => {
    renderInRouter(
      <FlowShell brand={brand} unread={0} online={false} title="Transfer" onBack={() => {}}>
        <p>Form</p>
      </FlowShell>,
    );
    expect(screen.getByRole('status', { name: 'Connection' })).toHaveTextContent("You're offline");
  });

  it('at 900 px and above: keeps the rail, with back and the title over the content', () => {
    stubMatchMedia(true);
    renderInRouter(
      <FlowShell brand={brand} unread={3} online title="Alerts" onBack={() => {}}>
        <p>Today</p>
      </FlowShell>,
      '/alerts',
    );
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getByRole('link', { name: 'Alerts, 3 unread' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('link', { name: /^Alerts, \d+ unread$/ })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Alerts' })).toHaveTextContent('Today');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
