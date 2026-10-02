import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation, useQuery } from '@tanstack/react-query';
import { join } from 'node:path';
import { useEffect } from 'react';
import { AppSessionProvider, useAppSession, type ApiWiring } from './AppSession';
import { createSampleApi, type SampleApi } from '../api/createSampleApi';
import { createLiveApi } from '../api/createLiveApi';
import { MobileApiError } from '../api/MobileApiError';
import type { PlatformApi } from '../api/PlatformApi';
import type { Platform } from '../platform/types';
import { createQueryClient } from '../queries/client';
import { cssRule } from '../test/cssRules';
import { fakePlatform } from '../test/fakePlatform';
import { createTokenStore } from './tokens';

function Probe() {
  const s = useAppSession();
  return (
    <div>
      <output data-testid="status">{s.status}</output>
      <output data-testid="online">{String(s.online)}</output>
      <output data-testid="brand">{s.brand?.name ?? ''}</output>
      <output data-testid="update">{JSON.stringify(s.updateRequired)}</output>
      <output data-testid="lock">{String(s.lockEnabled)}</output>
      <output data-testid="unlocking">{JSON.stringify(s.unlocking)}</output>
      <button onClick={() => void s.enterSample()}>enter</button>
      <button onClick={() => s.lock()}>lock now</button>
      <button onClick={() => void s.unlock()}>unlock</button>
      <button onClick={() => void s.unlock('000000')}>unlock with 000000</button>
      <button onClick={() => void s.setLockEnabled(false)}>lock off</button>
      <button onClick={() => void s.setLockEnabled(true)}>lock on</button>
      <button
        onClick={() =>
          void s.confirm('Send $10.00 to $grace').then((ok) => {
            document.title = ok ? 'confirmed' : 'cancelled';
          })
        }
      >
        confirm
      </button>
      <button onClick={() => s.setTheme('ivory')}>ivory</button>
      <button onClick={() => void s.signOut()}>sign out</button>
    </div>
  );
}

const hidden = (value: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const status = () => screen.getByTestId('status');
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const UNREADABLE = 'The secure storage key cannot be read.';

/** Takes the lock a fresh sign-in offers: the device's own prompt, which the fake grants. */
async function setUpDeviceLock(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Use Face ID / Touch ID / Windows Hello' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('AppSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts signed out, enters sample mode and applies the brand theme', async () => {
    render(
      <AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('brand').textContent?.length).toBeGreaterThan(0);
    expect(document.documentElement.dataset.theme).toBe('orbital');
  });

  it('locks after five minutes hidden unless the lock is off, and always on lock now', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await setUpDeviceLock(user); // a fresh sign-in offers the lock
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(4 * 60 * 1000);
      hidden('visible');
    });
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      hidden('visible');
    });
    expect(screen.getByTestId('status')).toHaveTextContent('locked');
    await user.click(screen.getByText('unlock'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await user.click(screen.getByText('lock off')); // asks for a confirmation first
    await user.click(await screen.findByRole('button', { name: 'Confirm' })); // the fake verifies
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('lock')).toHaveTextContent('false');
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(6 * 60 * 1000);
      hidden('visible');
    });
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    await user.click(screen.getByText('lock now'));
    expect(screen.getByTestId('status')).toHaveTextContent('locked');
  });

  it('tracks the network and goes back online without a reload', async () => {
    render(
      <AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('true'));
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('online')).toHaveTextContent('false');
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByTestId('online')).toHaveTextContent('true');
  });

  it('shows the confirmation sheet with the reason and resolves true or false', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider
        api={createSampleApi({ latencyMs: 0 })}
        platform={fakePlatform({
          lock: { verifyPasscode: () => Promise.resolve({ ok: false, attemptsLeft: 4 }) },
        })}
      >
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('confirm'));
    expect(await screen.findByRole('dialog', { name: 'Confirm' })).toHaveTextContent(
      'Send $10.00 to $grace',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    await user.click(screen.getByText('confirm'));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.title).toBe('confirmed'));
  });

  it('lands on sign-in when the session was revoked while locked', async () => {
    let api: SampleApi | undefined;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider
        api={({ events }) => (api = createSampleApi({ latencyMs: 0, ...events }))}
        platform={fakePlatform()}
      >
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('lock now'));
    act(() => api?._test_revoke()); // every later call answers 401 session_revoked
    await user.click(screen.getByText('unlock')); // unlock refetches /me, which now fails
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    // The public brand survives.
    expect(screen.getByTestId('brand').textContent?.length).toBeGreaterThan(0);
  });

  it('says an update is required when the platform needs a newer app', async () => {
    render(
      <AppSessionProvider
        api={createSampleApi({ latencyMs: 0, minSupportedAppVersion: '99.0.0' })}
        platform={fakePlatform()}
      >
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('update')).toHaveTextContent('"99.0.0"'));
  });
});

/** Renders the Probe over `api` and waits for the launch to settle on a status. */
async function launch(
  api: PlatformApi | ((wiring: ApiWiring) => PlatformApi),
  platform = fakePlatform(),
) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <AppSessionProvider api={api} platform={platform}>
      <Probe />
    </AppSessionProvider>,
  );
  await waitFor(() => expect(status()).not.toHaveTextContent('loading'));
  return user;
}

describe('AppSession: launching with a stored session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('app.sample', '1');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens locked when a lock is set up on this device', async () => {
    await launch(createSampleApi({ latencyMs: 0 }));
    expect(status()).toHaveTextContent('locked');
  });

  it('opens signed in when no lock was ever set up on this device', async () => {
    await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } }),
    );
    expect(status()).toHaveTextContent('signed-in');
  });

  it('opens signed in when the investor turned the lock off', async () => {
    localStorage.setItem('app.lockEnabled', 'false');
    await launch(createSampleApi({ latencyMs: 0 }));
    expect(status()).toHaveTextContent('signed-in');
    expect(screen.getByTestId('lock')).toHaveTextContent('false');
  });

  it('ends the session here, never unlocked, when the lock is on but gone', async () => {
    localStorage.setItem('app.lockEnabled', 'true');
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    await launch(api, fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } }));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    // This tab may be behind the shared store: the platform is not told, so a newer sign-in made
    // elsewhere is never ended there.
    expect(logout).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('app.sample')).toBeNull();
  });

  it('resets secure storage and shows sign-in when its key cannot be read', async () => {
    const reset = vi.fn(() => Promise.resolve());
    await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({
        storage: { reset },
        lock: { enrolled: () => Promise.reject(new Error(UNREADABLE)) },
      }),
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('counts down a wrong passcode and signs out after the last attempt', async () => {
    const verifyPasscode = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, attemptsLeft: 4 })
      .mockResolvedValueOnce({ ok: false, attemptsLeft: 0 });
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { enrolled: () => Promise.resolve('passcode'), verifyPasscode } }),
    );
    expect(status()).toHaveTextContent('locked');
    await user.click(screen.getByText('unlock with 000000'));
    await waitFor(() =>
      expect(screen.getByTestId('unlocking')).toHaveTextContent('"attemptsLeft":4'),
    );
    expect(status()).toHaveTextContent('locked');
    await user.click(screen.getByText('unlock with 000000'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(verifyPasscode).toHaveBeenCalledWith('000000');
  });

  it('stays locked, and says so, when the lock check fails', async () => {
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { verify: () => Promise.reject(new Error('NotReadableError')) } }),
    );
    await user.click(screen.getByText('unlock'));
    await waitFor(() => expect(screen.getByTestId('unlocking')).toHaveTextContent('"error"'));
    expect(status()).toHaveTextContent('locked');
  });

  it('stays locked when the device does not confirm it is the investor', async () => {
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { verify: () => Promise.resolve(false) } }),
    );
    await user.click(screen.getByText('unlock'));
    await waitFor(() => expect(screen.getByTestId('unlocking')).toHaveTextContent('"error"'));
    expect(status()).toHaveTextContent('locked');
  });
});

describe('AppSession: the lock while signed in', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks on return when five minutes passed while hidden, though no timer fired', async () => {
    const user = await launch(createSampleApi({ latencyMs: 0 }));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    act(() => {
      hidden('hidden');
      vi.setSystemTime(Date.now() + 5 * 60 * 1000); // the clock moves, no timer runs
      hidden('visible');
    });
    expect(status()).toHaveTextContent('locked');
  });

  it('cancels a pending confirmation when the app locks', async () => {
    const user = await launch(createSampleApi({ latencyMs: 0 }));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('confirm'));
    await screen.findByRole('dialog', { name: 'Confirm' });
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(5 * 60 * 1000);
      hidden('visible');
    });
    expect(status()).toHaveTextContent('locked');
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the lock on when turning it off is cancelled', async () => {
    const user = await launch(createSampleApi({ latencyMs: 0 }));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    expect(screen.getByTestId('lock')).toHaveTextContent('true');
    await user.click(screen.getByText('lock off'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('lock')).toHaveTextContent('true');
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
  });

  it('offers a lock when confirming without one, and confirms plainly after Not now', async () => {
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' })); // first sign-in
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('confirm'));
    const sheet = await screen.findByRole('dialog', { name: 'Confirm' });
    expect(sheet).toHaveTextContent('Set up a device lock');
    await user.click(screen.getByRole('button', { name: 'Set up the lock' }));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('dialog', { name: 'Confirm' })).not.toHaveTextContent(
      'Set up a device lock',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.title).toBe('confirmed'));
  });
});

describe('AppSession: confirming with the lock', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Signs in, sets up the device's own lock, and opens a confirmation. */
  async function confirmWithDeviceLock(platform: Platform) {
    const user = await launch(createSampleApi({ latencyMs: 0 }), platform);
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('confirm'));
    await screen.findByRole('dialog', { name: 'Confirm' });
    return user;
  }

  it('stays open, and says so, when the device does not confirm it is the investor', async () => {
    const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = await confirmWithDeviceLock(fakePlatform({ lock: { verify } }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your device didn't confirm it's you.",
    );
    expect(document.title).toBe('');
    await user.click(screen.getByRole('button', { name: 'Confirm' })); // and tries again
    await waitFor(() => expect(document.title).toBe('confirmed'));
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('stays open, and says so, when the lock cannot be checked', async () => {
    const user = await confirmWithDeviceLock(
      fakePlatform({ lock: { verify: () => Promise.reject(new Error('NotReadableError')) } }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The lock couldn't be checked. Try again.",
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    expect(document.title).toBe('');
    expect(status()).toHaveTextContent('signed-in');
  });

  it('cancels, and signs out, after the last wrong passcode', async () => {
    const verifyPasscode = vi.fn(() => Promise.resolve({ ok: false, attemptsLeft: 0 }));
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({ lock: { verifyPasscode } }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('confirm'));
    await user.type(await screen.findByLabelText('Passcode'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(verifyPasscode).toHaveBeenCalledWith('000000');
  });
});

describe('AppSession: a lock another tab changes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Signs in afresh and passes on the lock offered: "Not now" leaves the setting unset. */
  async function signInWithoutLock(platform: Platform) {
    const user = await launch(createSampleApi({ latencyMs: 0 }), platform);
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem('app.lockEnabled')).toBeNull();
    expect(screen.getByTestId('lock')).toHaveTextContent('false');
    return user;
  }

  /** Another tab sets up the device's own lock; a storage event tells this tab, if `heard`. */
  async function lockSetUpElsewhere(platform: Platform, heard: boolean) {
    await platform.lock.enrollWebAuthn({ id: 'inv_1', email: 'investor@sample.app' });
    localStorage.setItem('app.lockEnabled', 'true');
    if (!heard) return;
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'app.lockEnabled', newValue: 'true' }),
      );
    });
  }

  it('hears of a lock set up elsewhere: confirm asks the device, and time away locks', async () => {
    const verify = vi.fn(() => Promise.resolve(false));
    const platform = fakePlatform({ lock: { verify } });
    const user = await signInWithoutLock(platform);
    await lockSetUpElsewhere(platform, true);
    await waitFor(() => expect(screen.getByTestId('lock')).toHaveTextContent('true'));
    await user.click(screen.getByText('confirm'));
    expect(await screen.findByRole('dialog', { name: 'Confirm' })).not.toHaveTextContent(
      'Set up a device lock',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your device didn't confirm it's you.",
    );
    expect(verify).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(5 * 60 * 1000);
      hidden('visible');
    });
    await waitFor(() => expect(status()).toHaveTextContent('locked'));
  });

  it('asks the device to confirm when a lock was set up elsewhere, unheard', async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const platform = fakePlatform({ lock: { verify } });
    const user = await signInWithoutLock(platform);
    await lockSetUpElsewhere(platform, false);
    await user.click(screen.getByText('confirm'));
    expect(await screen.findByRole('dialog', { name: 'Confirm' })).not.toHaveTextContent(
      'Set up a device lock',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.title).toBe('confirmed'));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('locks after five minutes away when a lock was set up elsewhere, unheard', async () => {
    const platform = fakePlatform();
    await signInWithoutLock(platform);
    await lockSetUpElsewhere(platform, false);
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(5 * 60 * 1000);
      hidden('visible');
    });
    await waitFor(() => expect(status()).toHaveTextContent('locked'));
  });

  it('locks now when a lock was set up elsewhere, unheard', async () => {
    const platform = fakePlatform();
    const user = await signInWithoutLock(platform);
    await lockSetUpElsewhere(platform, false);
    await user.click(screen.getByText('lock now'));
    await waitFor(() => expect(status()).toHaveTextContent('locked'));
  });

  it('ends the session here, never opening, when another tab removes the lock', async () => {
    sessionStorage.setItem('app.sample', '1');
    localStorage.setItem('app.lockEnabled', 'true');
    const platform = fakePlatform();
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    await launch(api, platform);
    expect(status()).toHaveTextContent('locked');
    await platform.lock.clear(); // another tab signs out: the lock goes, and its setting
    localStorage.removeItem('app.lockEnabled');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'app.lockEnabled' }));
    });
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).not.toHaveBeenCalled();
  });
});

describe('AppSession: a lock whose record is lost', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Signs in and sets up the device's own lock (app.lockEnabled becomes true), then loses the
   * lock's record behind the session's back, without a sign-out.
   */
  async function lockLost() {
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    const platform = fakePlatform();
    const user = await launch(api, platform);
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
    await platform.lock.clear();
    return { user, logout };
  }

  it('ends the session here on Lock now', async () => {
    const { user, logout } = await lockLost();
    await user.click(screen.getByText('lock now'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).not.toHaveBeenCalled();
  });

  it('ends the session here after five minutes away', async () => {
    const { logout } = await lockLost();
    act(() => {
      hidden('hidden');
      vi.advanceTimersByTime(5 * 60 * 1000);
      hidden('visible');
    });
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).not.toHaveBeenCalled();
  });
});

describe('AppSession: signing out', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends the session at the platform and on this device', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    const clear = vi.fn(() => Promise.resolve());
    const unsubscribe = vi.fn(() => Promise.resolve(null));
    const user = await launch(
      api,
      fakePlatform({ lock: { clear }, notifications: { unsubscribe } }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' })); // the lock offer
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sessionStorage.getItem('app.sample')).toBe('1');
    expect(clear).toHaveBeenCalledTimes(1); // the fresh sign-in wiped the device's lock
    localStorage.setItem('app.lockEnabled', 'true');
    await user.click(screen.getByText('sign out'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('app.sample')).toBeNull();
    expect(localStorage.getItem('app.lockEnabled')).toBeNull();
  });

  it('signs out here after three seconds when the platform does not answer', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const user = await launch(api);
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('sign out'));
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(status()).toHaveTextContent('signed-in');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
  });

  it('says so when signing out cannot remove the lock from this device', async () => {
    let broken = false;
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({
        lock: {
          clear: () => (broken ? Promise.reject(new Error('disk error')) : Promise.resolve()),
        },
      }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    broken = true;
    await user.click(screen.getByText('sign out'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    const notice = screen.getByText(/Your session couldn't be fully removed from this device\./);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('signs out on the client’s own sign-out, without asking the platform', async () => {
    let wired: ApiWiring | undefined;
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    const user = await launch((wiring) => {
      wired = wiring;
      return api;
    });
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    act(() => wired?.events.onSignedOut('refresh_failed'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).not.toHaveBeenCalled();
  });

  it('signs out when the live client hears that the session was revoked', async () => {
    const sample = createSampleApi({ latencyMs: 0 });
    // The platform answers its brand, and 401 `session_revoked` to every signed-in call.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const brand = urlOf(input).endsWith('/brand');
      const json = brand ? await sample.brand() : { error: 'session_revoked' };
      return new Response(JSON.stringify(json), {
        status: brand ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const pair = {
      tokenType: 'Bearer' as const,
      accessToken: 'a1',
      refreshToken: 'r1',
      accessExpiresAt: '2026-10-01T12:15:00.000Z',
      refreshExpiresAt: '2026-10-31T12:00:00.000Z',
    };
    function SignIn() {
      const s = useAppSession();
      return <button onClick={() => void s.signIn(pair)}>sign in live</button>;
    }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider
        api={({ events, tokenStore }) =>
          createLiveApi({
            baseUrl: 'https://platform.test/api/mobile/v1',
            tokenStore,
            app: { version: '1.0.0', platform: 'web', deviceId: 'device-test-1' },
            fetchImpl,
            ...events,
          })
        }
        platform={fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } })}
      >
        <Probe />
        <SignIn />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('sign in live'));
    // The first signed-in call (/me) meets the revoked session: the client clears the store and
    // tells the session, which shows sign-in.
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(fetchImpl.mock.calls.some(([input]) => urlOf(input).endsWith('/me'))).toBe(true);
  });

  it('stays signed in when a call is refused session_revoked and no one signs out', async () => {
    // The live client throws `session_revoked` without onSignedOut when its store has moved on to
    // another sign-in: only onSignedOut (or the investor) ends a session, never the cache.
    const refused = () => Promise.reject(new MobileApiError('session_revoked', 401));
    function Refused() {
      useQuery({ queryKey: ['sample', 'refused'], queryFn: refused });
      const { mutate } = useMutation({ mutationFn: refused });
      useEffect(() => mutate(), [mutate]);
      return null;
    }
    function Gate() {
      return useAppSession().status === 'signed-in' ? <Refused /> : null;
    }
    const queryClient = createQueryClient();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider
        api={createSampleApi({ latencyMs: 0 })}
        platform={fakePlatform()}
        queryClient={queryClient}
      >
        <Probe />
        <Gate />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => {
      expect(queryClient.getQueryState(['sample', 'refused'])?.status).toBe('error');
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe('error');
    });
    expect(status()).toHaveTextContent('signed-in');
    expect(sessionStorage.getItem('app.sample')).toBe('1');
  });

  it('shows sign-in when a call cannot read the session from this device', async () => {
    function Failing() {
      useQuery({
        queryKey: ['sample', 'failing'],
        queryFn: () => Promise.reject(new MobileApiError('storage_error', 0)),
      });
      return null;
    }
    function Gate() {
      return useAppSession().status === 'signed-in' ? <Failing /> : null;
    }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
        <Probe />
        <Gate />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(sessionStorage.getItem('app.sample')).toBeNull();
  });
});

describe('AppSession: the platform’s answers', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('requires an update on a 426, even one that names no version', async () => {
    let wired: ApiWiring | undefined;
    await launch((wiring) => {
      wired = wiring;
      return createSampleApi({ latencyMs: 0 });
    });
    expect(screen.getByTestId('update')).toHaveTextContent('null');
    act(() => wired?.events.onUpgradeRequired(''));
    expect(screen.getByTestId('update')).toHaveTextContent('""');
    act(() => wired?.events.onUpgradeRequired('2.1.0'));
    expect(screen.getByTestId('update')).toHaveTextContent('"2.1.0"');
  });

  it('ends an open confirmation as cancelled when the platform requires an update', async () => {
    document.title = '';
    let wired: ApiWiring | undefined;
    const user = await launch((wiring) => {
      wired = wiring;
      return createSampleApi({ latencyMs: 0 });
    });
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('confirm'));
    await screen.findByRole('dialog', { name: 'Confirm' });
    act(() => wired?.events.onUpgradeRequired('2.0.0'));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ends an open confirmation as cancelled when a newer brand requires an update', async () => {
    document.title = '';
    const api = createSampleApi({ latencyMs: 0 });
    const brand = await api.brand();
    const queryClient = createQueryClient();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={api} platform={fakePlatform()} queryClient={queryClient}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('confirm'));
    await screen.findByRole('dialog', { name: 'Confirm' });
    vi.spyOn(api, 'brand').mockResolvedValue({ ...brand, minSupportedAppVersion: '99.0.0' });
    await act(() => queryClient.refetchQueries({ queryKey: ['sample', 'brand'] }));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.getByTestId('update')).toHaveTextContent('"99.0.0"');
  });

  it('keeps the notice’s live region in the page while it has nothing to say', () => {
    // An empty region that is hidden leaves the accessibility tree, and its first words go unsaid.
    const css = join(import.meta.dirname, 'AppSession.module.css');
    for (const selector of ['.notice', '.message', '.message:empty']) {
      const rule = cssRule(css, selector);
      expect(rule.display, selector).not.toBe('none');
      expect(rule.visibility, selector).not.toBe('hidden');
    }
  });

  it('says so when the session could not be saved on this device', async () => {
    let wired: ApiWiring | undefined;
    await launch((wiring) => {
      wired = wiring;
      return createSampleApi({ latencyMs: 0 });
    });
    act(() => wired?.events.onStorageError(new Error('QuotaExceededError')));
    const notice = screen.getByText('Could not save your session on this device.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('builds the sample world from the address it was opened at', async () => {
    window.history.replaceState(null, '', '/sign-in?sampleMinVersion=99.0.0');
    render(
      <AppSessionProvider platform={fakePlatform()}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('update')).toHaveTextContent('"99.0.0"'));
  });

  it('paints the brand’s default theme, and the investor’s choice once made', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    const brand = await api.brand();
    vi.spyOn(api, 'brand').mockResolvedValue({ ...brand, defaultTheme: 'verdant' });
    const user = await launch(api);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('verdant'));
    await user.click(screen.getByText('ivory'));
    expect(document.documentElement.dataset.theme).toBe('ivory');
    expect(localStorage.getItem('app.theme')).toBe('ivory');
  });
});

describe('AppSession: setting up the lock', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.title = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wipes a lock an earlier session left on this device, and offers a new one', async () => {
    localStorage.setItem('app.lockEnabled', 'true'); // the earlier session's setting
    const platform = fakePlatform(); // and its lock, still set up on the device
    const clear = vi.spyOn(platform.lock, 'clear');
    const user = await launch(createSampleApi({ latencyMs: 0 }), platform);
    await user.click(screen.getByText('enter'));
    await screen.findByRole('dialog', { name: 'Lock the app on this device' });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await platform.lock.enrolled()).toBeNull();
    expect(screen.getByTestId('lock')).toHaveTextContent('false');
    expect(localStorage.getItem('app.lockEnabled')).toBeNull();
  });

  it('does not sign in over a lock it cannot wipe', async () => {
    function Enter() {
      const s = useAppSession();
      const failed = (error: unknown) => {
        document.title = MobileApiError.is(error) ? error.code : 'other';
      };
      return <button onClick={() => void s.enterSample().catch(failed)}>enter or fail</button>;
    }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider
        api={createSampleApi({ latencyMs: 0 })}
        platform={fakePlatform({ lock: { clear: () => Promise.reject(new Error('disk error')) } })}
      >
        <Probe />
        <Enter />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter or fail'));
    await waitFor(() => expect(document.title).toBe('storage_error'));
    expect(status()).toHaveTextContent('signed-out');
    expect(sessionStorage.getItem('app.sample')).toBeNull();
  });

  it('resets storage whose key is lost, which wipes the lock, and signs in', async () => {
    const reset = vi.fn(() => Promise.resolve());
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({
        storage: { reset },
        lock: { clear: () => Promise.reject(new Error(UNREADABLE)) },
      }),
    );
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers a lock after the first sign-in, and turns it on once a passcode is set', async () => {
    const enrollPasscode = vi.fn(() => Promise.resolve());
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({
        lock: {
          enrolled: () => Promise.resolve(null),
          available: () => Promise.resolve('passcode'),
          enrollPasscode,
        },
      }),
    );
    await user.click(screen.getByText('enter'));
    await screen.findByRole('dialog', { name: 'Lock the app on this device' });
    await user.click(screen.getByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(enrollPasscode).toHaveBeenCalledWith('246810');
    expect(screen.getByTestId('lock')).toHaveTextContent('true');
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
  });

  it('offers the passcode when the browser cannot hold a device lock', async () => {
    const user = await launch(
      createSampleApi({ latencyMs: 0 }),
      fakePlatform({
        lock: {
          enrolled: () => Promise.resolve(null),
          enrollWebAuthn: () =>
            Promise.reject(new Error('This browser cannot enrol a device lock.')),
        },
      }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(
      await screen.findByRole('button', { name: 'Use Face ID / Touch ID / Windows Hello' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Set a passcode instead.');
    expect(screen.queryByRole('button', { name: /Face ID/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();
  });

  it('turns the lock back on without asking, while one is set up', async () => {
    const user = await launch(createSampleApi({ latencyMs: 0 }));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('lock off'));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByTestId('lock')).toHaveTextContent('false'));
    await user.click(screen.getByText('lock on'));
    await waitFor(() => expect(screen.getByTestId('lock')).toHaveTextContent('true'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
  });

  it('asks for the passcode to confirm, and counts a wrong one', async () => {
    const user = await launch(createSampleApi({ latencyMs: 0 }));
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('confirm'));
    await user.type(await screen.findByLabelText('Passcode'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('5 attempts left');
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.title).toBe('confirmed'));
  });

  it('unlocks offline at once, never waiting on a fetch the network holds back', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    const queryClient = createQueryClient();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={api} platform={fakePlatform()} queryClient={queryClient}>
        <Probe />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    const me = vi.spyOn(api, 'me');
    const fetchOfMe = () => queryClient.getQueryState(['sample', 'me'])?.fetchStatus;
    try {
      // Offline, and back to the app a while later: the investor's details, now stale, are
      // fetched again on focus, and that fetch waits for the network.
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        window.dispatchEvent(new Event('offline'));
        vi.advanceTimersByTime(31_000);
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      });
      await waitFor(() => expect(fetchOfMe()).toBe('paused'));
      await user.click(screen.getByText('lock now'));
      expect(status()).toHaveTextContent('locked');
      me.mockClear();
      await user.click(screen.getByText('unlock'));
      await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
      expect(me).not.toHaveBeenCalled(); // offline, the platform is not asked
    } finally {
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));
      });
      await waitFor(() => expect(fetchOfMe()).toBe('idle'));
    }
  });

  it('opens on the device’s word when the platform cannot be reached', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'me').mockRejectedValue(MobileApiError.network());
    const user = await launch(api);
    await user.click(screen.getByText('enter'));
    await setUpDeviceLock(user);
    await user.click(screen.getByText('lock now'));
    await user.click(screen.getByText('unlock'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
  });
});

describe('AppSession: a live session', () => {
  const pair = {
    tokenType: 'Bearer' as const,
    accessToken: 'a1',
    refreshToken: 'r1',
    accessExpiresAt: '2026-10-01T12:15:00.000Z',
    refreshExpiresAt: '2026-10-31T12:00:00.000Z',
  };

  /** A platform that answers its brand and /me, and the session's live client over it. */
  function liveApi({ events, tokenStore }: ApiWiring) {
    const sample = createSampleApi({ latencyMs: 0 });
    return createLiveApi({
      baseUrl: 'https://platform.test/api/mobile/v1',
      tokenStore,
      app: { version: '1.0.0', platform: 'web', deviceId: 'device-test-1' },
      fetchImpl: async (input) => {
        const json = urlOf(input).endsWith('/brand') ? await sample.brand() : await sample.me();
        return new Response(JSON.stringify(json), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      ...events,
    });
  }

  function SignIn() {
    const s = useAppSession();
    return <button onClick={() => void s.signIn(pair)}>sign in live</button>;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('app.lockEnabled', 'false');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows another tab that signs out, or signs in', async () => {
    const platform = fakePlatform();
    const otherTab = createTokenStore(platform.storage);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={liveApi} platform={platform}>
        <Probe />
        <SignIn />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('sign in live'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    const stop = otherTab.subscribe(() => {}); // opens its channel to this tab
    await otherTab.clear();
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await otherTab.start({ ...pair, accessToken: 'a2', refreshToken: 'r2' });
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    stop();
  });

  it('wipes a lock left on this device before a fresh sign-in', async () => {
    const platform = fakePlatform(); // an earlier session's lock is still set up
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={liveApi} platform={platform}>
        <Probe />
        <SignIn />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('sign in live'));
    await screen.findByRole('dialog', { name: 'Lock the app on this device' });
    expect(await platform.lock.enrolled()).toBeNull();
    expect(screen.getByTestId('lock')).toHaveTextContent('false');
  });

  it('says so when signing out cannot remove the session from this device', async () => {
    const device = fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } });
    let broken = false;
    const platform = {
      ...device,
      storage: {
        ...device.storage,
        remove: (key: string) =>
          broken ? Promise.reject(new Error('disk error')) : device.storage.remove(key),
      },
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={liveApi} platform={platform}>
        <Probe />
        <SignIn />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('sign in live'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    broken = true;
    await user.click(screen.getByText('sign out'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    const notice = screen.getByText(/Your session couldn't be fully removed from this device\./);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('resets storage whose key cannot be read, and keeps the sign-in', async () => {
    const device = fakePlatform();
    const reset = vi.fn(() => Promise.resolve());
    let refused = false;
    const platform = {
      ...device,
      storage: {
        ...device.storage,
        // The first write meets the lost key; after the reset, writes work.
        set: (key: string, value: string) => {
          if (refused) return device.storage.set(key, value);
          refused = true;
          return Promise.reject(new Error(UNREADABLE));
        },
        reset,
      },
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppSessionProvider api={liveApi} platform={platform}>
        <Probe />
        <SignIn />
      </AppSessionProvider>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('sign in live'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('AppSession: a build it cannot use', () => {
  it('says the app is not set up, and why, to the console', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const problem = new TypeError('createLiveApi: baseUrl must be an absolute http or https URL');
    render(
      <AppSessionProvider
        api={() => {
          throw problem;
        }}
        platform={fakePlatform()}
      >
        <Probe />
      </AppSessionProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("This app isn't set up correctly");
    expect(screen.queryByTestId('status')).toBeNull();
    expect(logged).toHaveBeenCalledWith('The app could not start:', problem);
    logged.mockRestore();
  });
});
