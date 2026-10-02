import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { createSampleApi } from '../api/createSampleApi';
import { format } from '../lib/format';
import type { LockMethod } from '../platform/types';
import { stubRadixBrowserApis } from '../test/browserStubs';
import { FAKE_PASSCODE, fakePlatform } from '../test/fakePlatform';
import { renderWithApp } from '../test/renderWithApp';
import { applyWaitingUpdate } from '../pwa/applyWaitingUpdate';
import { App } from './App';
import { AppProviders } from './providers';
import { routes } from './router';

// The update screen's Reload takes the new version through the service worker, which jsdom lacks.
vi.mock('../pwa/applyWaitingUpdate', () => ({
  applyWaitingUpdate: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** The app's own top route (its layout, error page and loading view), over `children`. */
function underTop(children: RouteObject[]): RouteObject[] {
  const [top] = routes;
  if (top === undefined || top.index === true) throw new Error('The app has no top layout route.');
  return [{ ...top, children }];
}

/**
 * The app over `router` and a fresh sample world, with jsdom's missing browser APIs (Radix's,
 * the starfield's canvas) stubbed, as renderWithApp does for the app's own routes.
 */
function renderApp(router: ReturnType<typeof createMemoryRouter>) {
  stubRadixBrowserApis();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  return render(
    <AppProviders api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
      <App router={router} />
    </AppProviders>,
  );
}

describe('the routes', () => {
  it('shows a loading screen while the session starts', () => {
    renderWithApp({ route: '/' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows nothing of the app while the session starts, however long that takes', async () => {
    renderWithApp({
      route: '/',
      signedIn: true,
      platform: { lock: { enrolled: () => new Promise<never>(() => {}) } }, // the device is slow
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home', hidden: true })).toBeNull();
    expect(screen.queryByRole('navigation', { hidden: true })).toBeNull();
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

  it('sends a notification’s address home until the alerts screen arrives', async () => {
    // The service worker opens /alerts?open=<id> on a notification's tap (Task 15 adds /alerts).
    const { router } = renderWithApp({ route: '/alerts?open=al_1', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the projected portfolio value on Home, hidden while offline', async () => {
    const { api } = renderWithApp({ route: '/', signedIn: true });
    await screen.findByRole('heading', { name: 'Home' });
    const { totals } = await api.dashboard();
    const value = format.money(totals.portfolioValueCents);
    await waitFor(() => expect(document.querySelector('[data-amount]')).toHaveTextContent(value));
    expect(screen.getByText(/Projected portfolio value/)).toContainElement(
      document.querySelector('[data-amount]'),
    );
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    expect(document.querySelector('[data-amount]')).toHaveTextContent('•••');
  });

  it('shows the screens in the tab layout', async () => {
    renderWithApp({ route: '/', signedIn: true });
    await screen.findByRole('heading', { name: 'Home' });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alerts, \d+ unread/ })).toBeInTheDocument();
  });

  it('shows a live build no sample ribbon and no sample world', async () => {
    renderWithApp({ route: '/sign-in', mode: 'live' });
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByText('Sample', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Explore with sample data' })).toBeNull();
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

  it('says on the sign-in screen why the session ended', async () => {
    const { api, router } = renderWithApp({ route: '/', signedIn: true });
    await screen.findByRole('heading', { name: 'Home' });
    act(() => api._test_revoke()); // the platform ends the session
    await act(() => api.me().catch(() => {})); // and the next call hears it
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    const notice = screen.getByText('Your session ended. Sign in again.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('counts the unread alerts on the bell', async () => {
    const unread = (await createSampleApi({ latencyMs: 0 }).notifications()).unreadCount;
    expect(unread).toBeGreaterThan(0);
    renderWithApp({ route: '/', signedIn: true });
    const bell = await screen.findByRole('link', { name: `Alerts, ${unread} unread` });
    expect(bell).toHaveTextContent(String(unread));
  });

  it('signs out from the lock with Sign out instead', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload
    const user = userEvent.setup();
    const { router } = renderWithApp({ route: '/' });
    await screen.findByRole('heading', { name: 'Locked' });
    await user.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('opens the lock with the passcode, and says what a wrong one leaves', async () => {
    sessionStorage.setItem('app.sample', '1');
    const user = userEvent.setup();
    const verifyPasscode = vi
      .fn<(code: string) => Promise<{ ok: boolean; attemptsLeft: number }>>()
      .mockResolvedValueOnce({ ok: false, attemptsLeft: 4 })
      .mockResolvedValue({ ok: true, attemptsLeft: 5 });
    renderWithApp({
      route: '/',
      platform: { lock: { enrolled: () => Promise.resolve('passcode'), verifyPasscode } },
    });
    await user.type(await screen.findByLabelText('Passcode'), '111111');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 attempts left');
    await user.type(screen.getByLabelText('Passcode'), FAKE_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(verifyPasscode).toHaveBeenLastCalledWith(FAKE_PASSCODE);
  });

  it('says on the lock when its check cannot run, and shows a check running', async () => {
    sessionStorage.setItem('app.sample', '1');
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    renderWithApp({
      route: '/',
      platform: {
        lock: {
          enrolled: () => Promise.resolve('passcode'),
          verifyPasscode: () => new Promise((_, reject) => (fail = reject)),
        },
      },
    });
    await user.type(await screen.findByLabelText('Passcode'), '111111');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unlock' })).toHaveAttribute('aria-busy', 'true'),
    );
    act(() => fail(new Error('storage busy')));
    expect(await screen.findByRole('alert')).toHaveTextContent("The lock couldn't be checked.");
    expect(screen.getByRole('button', { name: 'Unlock' })).not.toHaveAttribute('aria-busy');
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

  it('takes the new version, not the precached one, on the update screen’s Reload', async () => {
    // Taking the new version can wait on the worker for a while: Reload shows it is under way.
    vi.mocked(applyWaitingUpdate).mockReturnValue(new Promise<void>(() => {}));
    renderWithApp({ route: '/', signedIn: true, sample: { minSupportedAppVersion: '99.0.0' } });
    await screen.findByRole('heading', { name: 'Update the app' });
    expect(applyWaitingUpdate).not.toHaveBeenCalled();
    const reload = screen.getByRole('button', { name: 'Reload' });
    await userEvent.setup().click(reload);
    expect(applyWaitingUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveAttribute('aria-busy', 'true');
  });

  it('ends a locked app whose lock is gone here, showing nothing of it meanwhile', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload
    let method: LockMethod | null = 'webauthn';
    let release!: () => void;
    const clearing = new Promise<void>((resolve) => (release = resolve));
    const { api } = renderWithApp({
      route: '/',
      // The session's end waits on the lock being cleared, until release().
      platform: { lock: { enrolled: () => Promise.resolve(method), clear: () => clearing } },
    });
    const logout = vi.spyOn(api, 'logout');
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    // Another tab signs out: the device's lock goes, and its setting.
    method = null;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'app.lockEnabled' }));
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Locked' })).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Home', hidden: true })).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    act(() => release());
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('replaces the address a signed-out visitor never reached with sign-in', async () => {
    const { router } = renderWithApp({ route: '/?from=link' });
    await screen.findByRole('button', { name: 'Explore with sample data' });
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('shows the loading view, with the ribbon, while a screen’s code is on its way', async () => {
    const router = createMemoryRouter(
      underTop([{ path: '/', lazy: () => new Promise<never>(() => {}) }]),
    );
    renderApp(router);
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByText('Sample', { exact: true })).toBeInTheDocument();
  });

  it('sends an address no route knows home', async () => {
    const router = createMemoryRouter(underTop([{ path: '/', element: <h1>Home</h1> }]), {
      initialEntries: ['/nowhere'],
    });
    renderApp(router);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('says plainly when a screen’s code cannot load, and reports why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
    const router = createMemoryRouter(
      underTop([{ path: '/', lazy: () => Promise.reject(failure) }]),
    );
    renderApp(router);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(warn).toHaveBeenCalledWith('[investor-app] showing a screen:', failure);
    logged.mockRestore();
  });

  it('says plainly when a screen fails, never with the router’s own page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const problem = new Error('a screen that cannot render');
    function Broken(): never {
      throw problem;
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
    renderApp(router);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[investor-app] showing a screen:', problem);
    logged.mockRestore();
  });
});
