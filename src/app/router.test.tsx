import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../test/renderWithApp';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the routes', () => {
  it('shows a loading screen while the session starts', () => {
    renderWithApp({ route: '/' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('takes a signed-out visitor through sign-in and back to where they were going', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp({ route: '/?from=link' });
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('?from=link');
  });

  it('sends an address the app does not have home', async () => {
    const { router } = renderWithApp({ route: '/nowhere', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the screens in the tab layout', async () => {
    renderWithApp({ route: '/', signedIn: true });
    await screen.findByRole('heading', { name: 'Home' });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alerts, \d+ unread/ })).toBeInTheDocument();
  });

  it('marks a sample session with the ribbon, once, on every screen', async () => {
    renderWithApp({ route: '/sign-in' });
    await screen.findByRole('button', { name: 'Explore with sample data' });
    expect(screen.getAllByText('Sample', { exact: true })).toHaveLength(1);
  });

  it('covers the app with the lock while locked, and gives it back once unlocked', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload
    const user = userEvent.setup();
    renderWithApp({ route: '/' });
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull(); // hidden beneath
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Locked' })).toBeNull());
  });

  it('shows the update screen in place of the app, where Sign out still works', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp({
      route: '/',
      signedIn: true,
      sample: { minSupportedAppVersion: '99.0.0' },
    });
    expect(await screen.findByRole('heading', { name: 'Update the app' })).toBeInTheDocument();
    expect(screen.getByText(/Update to version 99\.0\.0 or later/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});
