import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateRequired } from './UpdateRequired';

const brand = { name: 'Northwind Wealth', logoDataUrl: null };

describe('UpdateRequired', () => {
  it('asks for the update, names the version and offers Reload and Sign out', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onSignOut = vi.fn();
    render(
      <UpdateRequired brand={brand} minVersion="1.4.0" onReload={onReload} onSignOut={onSignOut} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Update the app' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Northwind Wealth');
    expect(screen.getByText(/version 1\.4\.0 or later/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows Reload busy while its reload is under way, and takes no second press', async () => {
    const user = userEvent.setup();
    let reloaded!: () => void;
    const onReload = vi.fn(() => new Promise<void>((resolve) => (reloaded = resolve)));
    render(
      <UpdateRequired brand={brand} minVersion="1.4.0" onReload={onReload} onSignOut={() => {}} />,
    );
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(reload).not.toHaveAttribute('aria-busy');
    await user.click(reload);
    expect(reload).toHaveAttribute('aria-busy', 'true');
    await user.click(reload);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled(); // still works
    act(() => reloaded());
    await waitFor(() => expect(reload).not.toHaveAttribute('aria-busy'));
  });

  it('links to the store when there is one, in a new tab', () => {
    render(
      <UpdateRequired
        brand={brand}
        minVersion="2.0.0"
        storeUrl="https://apps.example.com/northwind"
        onSignOut={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: 'Get the update (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://apps.example.com/northwind');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('still asks plainly when the platform did not say which version', () => {
    render(<UpdateRequired brand={null} minVersion="" onReload={() => {}} onSignOut={() => {}} />);
    expect(screen.getByRole('main')).toHaveTextContent(
      'This version is no longer supported. Update to the latest version to carry on.',
    );
  });
});
