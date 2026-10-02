import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { createSampleApi } from '../api/createSampleApi';
import type { LockMethod } from '../platform/types';
import { fakePlatform } from '../test/fakePlatform';
import { renderWithApp } from '../test/renderWithApp';
import { App } from './App';
import { AppProviders } from './providers';
import { routes } from './router';

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
    await user.click(await screen.findByRole('button', { name: 'Not now' })); // the lock offer
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
    // The screen stays mounted beneath the lock, hidden from assistive technology.
    expect(screen.getByRole('heading', { name: 'Home', hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull();
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

  it('never opens a locked app whose lock is gone: it signs out, showing nothing meanwhile', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload
    let method: LockMethod | null = 'webauthn';
    renderWithApp({
      route: '/',
      latencyMs: 50, // the sign-out takes a moment
      platform: { lock: { enrolled: () => Promise.resolve(method) } },
    });
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    // Another tab signs out: the device's lock goes, and its setting.
    method = null;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'app.lockEnabled' }));
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Locked' })).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Home', hidden: true })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
  });

  it('says plainly when a screen fails, never with the router’s own page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): never {
      throw new Error('a screen that cannot render');
    }
    // The app's own top route, with a screen that fails beneath it.
    const [top] = routes;
    const router = createMemoryRouter([
      {
        element: top?.element,
        errorElement: top?.errorElement,
        children: [{ path: '/', element: <Broken /> }],
      },
    ]);
    render(
      <AppProviders api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
        <App router={router} />
      </AppProviders>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
    expect(logged).toHaveBeenCalled(); // the error still reaches the console
    logged.mockRestore();
  });
});
