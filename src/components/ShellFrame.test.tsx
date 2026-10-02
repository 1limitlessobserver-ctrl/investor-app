import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInRouter } from '../test/renderInRouter';
import { ShellFrame } from './ShellFrame';

const brand = { name: 'Northwind Wealth', logoDataUrl: null };

describe('ShellFrame', () => {
  it('stacks header, banners, content and footer on phones, with no rail', () => {
    renderInRouter(
      <ShellFrame
        layout="phone"
        brand={brand}
        unread={0}
        header={<p>header</p>}
        banners={<p>banners</p>}
        footer={<p>footer</p>}
      >
        <p>screen</p>
      </ShellFrame>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('headerbanners');
    expect(screen.getByRole('main')).toHaveTextContent('screen');
    expect(screen.getByText('footer')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Northwind Wealth')).toBeNull();
  });

  it('puts the brand and the rail beside the content column at 900 px and above', () => {
    renderInRouter(
      <ShellFrame
        layout="wide"
        brand={brand}
        unread={4}
        header={<p>header</p>}
        banners={<p>banners</p>}
        footer={<p>footer</p>}
      >
        <p>screen</p>
      </ShellFrame>,
    );
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getAllByRole('link')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Alerts, 4 unread' })).toBeInTheDocument();
    expect(screen.getByText('Northwind Wealth')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('screen');
    expect(screen.getByText('header')).toBeInTheDocument();
    expect(screen.queryByText('footer')).toBeNull();
  });

  it('leaves the header out when there is none', () => {
    renderInRouter(
      <ShellFrame layout="wide" brand={null} unread={0} header={null} banners={null}>
        <p>screen</p>
      </ShellFrame>,
    );
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('lets keyboard users skip straight to the content', async () => {
    const user = userEvent.setup();
    renderInRouter(
      <ShellFrame
        layout="phone"
        brand={brand}
        unread={0}
        header={<a href="/x">first</a>}
        banners={null}
      >
        <p>screen</p>
      </ShellFrame>,
    );
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
