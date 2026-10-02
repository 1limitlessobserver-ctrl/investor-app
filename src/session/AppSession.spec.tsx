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
import { createLock } from '../platform/web/lock';
import { createSecureStorage } from '../platform/web/storage';
import { createQueryClient } from '../queries/client';
import { cssRule } from '../test/cssRules';
import { fakePlatform } from '../test/fakePlatform';
import { memoryKvStore } from '../test/memoryKvStore';
import { createSessionController } from './sessionController';
import { createTokenStore, type TokenStoreEvent } from './tokens';

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

// The page as each test left it: back online, in view, untitled (vitest.setup.ts does the same).
afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine');
  Reflect.deleteProperty(document, 'visibilityState');
  document.title = '';
});
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

  it('ends nothing once the investor signs in again while storage is being reset', async () => {
    let release!: () => void;
    const reset = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    let unreadable = true;
    const enrolled = () =>
      unreadable ? Promise.reject(new Error(UNREADABLE)) : Promise.resolve(null);
    render(
      <AppSessionProvider
        api={createSampleApi({ latencyMs: 0 })}
        platform={fakePlatform({ storage: { reset }, lock: { enrolled } })}
      >
        <Probe />
      </AppSessionProvider>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1)); // the launch met a lost key
    unreadable = false;
    await user.click(screen.getByText('enter')); // a new session begins meanwhile
    await waitFor(() => expect(status()).toHaveTextContent('signed-in'));
    act(() => release());
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(status()).toHaveTextContent('signed-in');
    expect(sessionStorage.getItem('app.sample')).toBe('1');
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

  it('signs out after a fifth wrong passcode, even one cancelled while it is checked', async () => {
    // The device's real lock: the fifth wrong passcode in a row wipes the passcode.
    const storage = createSecureStorage({ db: memoryKvStore() });
    const lock = createLock({ storage, rpId: 'localhost', origin: 'http://localhost' });
    const user = await launch(createSampleApi({ latencyMs: 0 }), {
      ...fakePlatform(),
      storage,
      lock,
    });
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Set a passcode' }));
    await user.type(screen.getByLabelText('Passcode'), '246810');
    await user.type(await screen.findByLabelText('Repeat passcode'), '246810');
    await user.click(screen.getByRole('button', { name: 'Save passcode' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5_000 });
    await user.click(screen.getByText('confirm')); // someone else tries passcodes on it
    for (let left = 4; left >= 1; left -= 1) {
      await user.type(await screen.findByLabelText('Passcode'), '000000');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      const attempts = left === 1 ? 'attempt' : 'attempts';
      await screen.findByText(`That passcode didn't match. ${left} ${attempts} left.`, undefined, {
        timeout: 5_000,
      });
    }
    await user.type(screen.getByLabelText('Passcode'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' })); // while the fifth is checked
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'), { timeout: 5_000 });
    expect(document.title).toBe('cancelled');
    expect(await lock.enrolled()).toBeNull();
    document.title = '';
    await user.click(screen.getByText('confirm')); // and nothing is confirmed from here
    await waitFor(() => expect(document.title).toBe('cancelled'));
  }, 30_000); // seven passcode checks, each a 310 000-round stretch

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

  it('cancels a confirmation, and ends the session here: nothing can check it', async () => {
    const { user, logout } = await lockLost();
    await user.click(screen.getByText('confirm'));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

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

  it('asks nothing while it signs out or ends: a confirmation is refused at once', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined)); // never answers
    const unsubscribe = vi.fn(() => new Promise<null>(() => undefined)); // waited for 3 s
    const platform = fakePlatform({
      lock: { enrolled: () => Promise.resolve(null) },
      notifications: { unsubscribe },
    });
    const user = await launch(api, platform);
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const enrolled = vi.spyOn(platform.lock, 'enrolled');
    await user.click(screen.getByText('sign out')); // the platform is waited for
    await user.click(screen.getByText('confirm'));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(status()).toHaveTextContent('signed-in');
    await act(() => vi.advanceTimersByTimeAsync(3_100)); // then the session ends here, on push
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    document.title = '';
    await user.click(screen.getByText('confirm'));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(enrolled).not.toHaveBeenCalled(); // refused at once, without a look at the lock
  });

  it('refuses a confirmation whose look at the lock outlasts the start of a sign-out', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    let release!: (method: null) => void;
    let holding = false;
    const enrolled = () =>
      holding ? new Promise<null>((resolve) => (release = resolve)) : Promise.resolve(null);
    const user = await launch(api, fakePlatform({ lock: { enrolled } }));
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    holding = true;
    await user.click(screen.getByText('confirm')); // it reads the device's lock first
    await user.click(screen.getByText('sign out')); // and the investor signs out meanwhile
    act(() => release(null));
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ends an open confirmation the moment the investor signs out', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const user = await launch(
      api,
      fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await user.click(screen.getByText('confirm'));
    await screen.findByRole('dialog', { name: 'Confirm' });
    act(() => screen.getByText('sign out').click()); // the sheet covers the page: a direct click
    await waitFor(() => expect(document.title).toBe('cancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(status()).toHaveTextContent('signed-in'); // still waiting on the platform
  });

  it('never unlocks while the investor signs out instead', async () => {
    sessionStorage.setItem('app.sample', '1');
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const verify = vi.fn(() => Promise.resolve(true));
    const user = await launch(api, fakePlatform({ lock: { verify } }));
    expect(status()).toHaveTextContent('locked');
    await user.click(screen.getByText('sign out')); // "Sign out instead", and then Unlock
    await user.click(screen.getByText('unlock'));
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(verify).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('locked');
  });

  it('joins the end of the session under way when the investor signs out meanwhile', async () => {
    let wired: ApiWiring | undefined;
    const api = createSampleApi({ latencyMs: 0 });
    const logout = vi.spyOn(api, 'logout');
    let release!: (endpoint: null) => void;
    const unsubscribe = vi.fn(() => new Promise<null>((resolve) => (release = resolve)));
    const user = await launch(
      (wiring) => {
        wired = wiring;
        return api;
      },
      fakePlatform({
        lock: { enrolled: () => Promise.resolve(null) },
        notifications: { unsubscribe },
      }),
    );
    await user.click(screen.getByText('enter'));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    act(() => wired?.events.onSignedOut('session_revoked')); // the platform ended it
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText('sign out')); // while this device still clears it
    act(() => release(null));
    await waitFor(() => expect(status()).toHaveTextContent('signed-out'));
    expect(logout).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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

// ---- Sessions driven without React: a tab is a started controller on a device ----

const pairOf = (n: number) => ({
  tokenType: 'Bearer' as const,
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  accessExpiresAt: '2026-10-01T12:15:00.000Z',
  refreshExpiresAt: '2026-10-31T12:00:00.000Z',
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

/** The live client over a platform that answers its brand and /me; `slowLogout` never answers. */
function liveOver({ slowLogout = false } = {}) {
  return ({ events, tokenStore }: ApiWiring) => {
    const sample = createSampleApi({ latencyMs: 0 });
    return createLiveApi({
      baseUrl: 'https://platform.test/api/mobile/v1',
      tokenStore,
      app: { version: '1.0.0', platform: 'web', deviceId: 'device-test-1' },
      fetchImpl: async (input) => {
        const url = urlOf(input);
        if (url.endsWith('/auth/logout')) {
          return slowLogout ? new Promise<Response>(() => {}) : json({ ok: true });
        }
        return json(url.endsWith('/brand') ? await sample.brand() : await sample.me());
      },
      ...events,
    });
  };
}

// The tabs a test opened, stopped after it.
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** A tab of the app on `device`: its session, started, over its own cache. */
function openTab(
  device: Platform,
  makeApi: (wiring: ApiWiring) => PlatformApi,
  tokenStore = createTokenStore(device.storage),
) {
  const queryClient = createQueryClient();
  const session = createSessionController({
    makeApi,
    platform: device,
    queryClient,
    tokenStore,
    appVersion: '1.0.0',
  });
  stops.push(session.start());
  return { session, queryClient, status: () => session.getSnapshot().status };
}

/** The session key stored on the device, or null. */
async function storedKey(device: Platform) {
  const raw = await device.storage.get('session');
  return raw === null ? null : (JSON.parse(raw) as { sessionKey: string }).sessionKey;
}

/** A promise that waits until release(), as a slow step of the device does. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { opened, release };
}

describe('AppSession: two tabs on one device', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a sign-in made elsewhere while its sign-out waited, and follows it', async () => {
    const device = fakePlatform();
    const a = openTab(device, liveOver({ slowLogout: true }));
    const b = openTab(device, liveOver());
    await waitFor(() => expect([a.status(), b.status()]).toEqual(['signed-out', 'signed-out']));
    await a.session.signIn(pairOf(1));
    await waitFor(() => expect(b.status()).toBe('signed-in'));
    const leaving = a.session.signOut(); // the platform does not answer for 3 s
    await waitFor(() => expect(b.status()).toBe('signed-out')); // the store was cleared first
    await b.session.signIn(pairOf(2)); // the investor signs in again, in the other tab
    const signedInAgain = await storedKey(device);
    await waitFor(() => expect(a.status()).toBe('signed-in')); // this tab follows it
    await vi.advanceTimersByTimeAsync(3_100); // the sign-out stops waiting for the platform
    await leaving;
    expect(await storedKey(device)).toBe(signedInAgain);
    expect([a.status(), b.status()]).toEqual(['signed-in', 'signed-in']);
  });

  it('never ends a sign-in this tab followed while its own end waited on push', async () => {
    const device = fakePlatform();
    const hanging = {
      ...device,
      notifications: { ...device.notifications, unsubscribe: () => new Promise<null>(() => {}) },
    };
    const a = openTab(hanging, liveOver());
    const b = openTab(device, liveOver());
    await waitFor(() => expect([a.status(), b.status()]).toEqual(['signed-out', 'signed-out']));
    await a.session.signIn(pairOf(1));
    await waitFor(() => expect(b.status()).toBe('signed-in'));
    const leaving = a.session.signOut(); // the platform hears at once; push does not answer
    await waitFor(() => expect(b.status()).toBe('signed-out'));
    await b.session.signIn(pairOf(2));
    await waitFor(() => expect(a.status()).toBe('signed-in')); // this tab follows it
    a.queryClient.setQueryData(['live', 'dashboard'], { of: 'the newer sign-in' });
    await vi.advanceTimersByTimeAsync(3_100); // push stops being waited for
    await leaving;
    expect(a.status()).toBe('signed-in');
    expect(a.queryClient.getQueryData(['live', 'dashboard'])).toEqual({ of: 'the newer sign-in' });
    expect(await storedKey(device)).not.toBeNull();
  });

  it('stops ending its session once it follows a newer one, at every step', async () => {
    // The step of ending the session under test waits while another tab signs in again.
    for (const step of ['the store', 'the lock'] as const) {
      const device = fakePlatform();
      const held = gate();
      let holding = false;
      const waitHere = (at: typeof step) => (holding && step === at ? held.opened : undefined);
      const tokenStore = createTokenStore(device.storage);
      const clearStore = tokenStore.clear.bind(tokenStore);
      const storeCleared = vi.fn();
      tokenStore.clear = async (key) => {
        storeCleared();
        await waitHere('the store');
        return clearStore(key);
      };
      const clearLock = vi.fn(async () => {
        await waitHere('the lock');
        await device.lock.clear();
      });
      const unsubscribe = vi.fn(() => Promise.resolve(null));
      const tabDevice = {
        ...device,
        lock: { ...device.lock, clear: clearLock },
        notifications: { ...device.notifications, unsubscribe },
      };
      let wired: ApiWiring | undefined;
      const a = openTab(
        tabDevice,
        (wiring) => {
          wired = wiring;
          return liveOver()(wiring);
        },
        tokenStore,
      );
      const b = openTab(device, liveOver());
      await waitFor(() => expect([a.status(), b.status()]).toEqual(['signed-out', 'signed-out']));
      await a.session.signIn(pairOf(1));
      await waitFor(() => expect(b.status()).toBe('signed-in'));
      clearLock.mockClear();
      holding = true;
      wired?.events.onSignedOut('session_revoked'); // this tab's session ends here, slowly
      await waitFor(() =>
        expect(step === 'the store' ? storeCleared : clearLock).toHaveBeenCalled(),
      );
      await b.session.signIn(pairOf(2)); // meanwhile the investor signs in again elsewhere
      await waitFor(() => expect(a.status(), step).toBe('signed-in'));
      held.release();
      await vi.advanceTimersByTimeAsync(50);
      expect(a.status(), step).toBe('signed-in');
      expect(unsubscribe, step).not.toHaveBeenCalled();
      expect(clearLock, step).toHaveBeenCalledTimes(step === 'the store' ? 0 : 1);
      for (const stop of stops.splice(0)) stop();
    }
  });

  it('ends the session it followed, though the last one’s end still waits', async () => {
    const device = fakePlatform();
    let first = true;
    // The first push unsubscribe never answers (it is waited for 3 s); later ones answer at once.
    const unsubscribe = () => {
      if (!first) return Promise.resolve(null);
      first = false;
      return new Promise<null>(() => {});
    };
    const a = openTab(
      { ...device, notifications: { ...device.notifications, unsubscribe } },
      liveOver(),
    );
    const otherTab = createTokenStore(device.storage);
    stops.push(otherTab.subscribe(() => {}));
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    void a.session.signOut(); // ends here, then waits on push
    await waitFor(async () => expect(await storedKey(device)).toBeNull());
    const key = await otherTab.start(pairOf(2)); // the investor signs in again elsewhere
    await waitFor(() => expect(a.status()).toBe('signed-in')); // this tab follows
    await otherTab.clear(key); // and signs out there at once
    await waitFor(() => expect(a.status()).toBe('signed-out'), { timeout: 1_000 });
  });

  it('signs out of the session it followed, though the sign-out before still waits', async () => {
    const device = fakePlatform();
    const a = openTab(device, liveOver({ slowLogout: true }));
    const otherTab = createTokenStore(device.storage);
    stops.push(otherTab.subscribe(() => {}));
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    void a.session.signOut(); // the platform does not answer for 3 s
    await waitFor(async () => expect(await storedKey(device)).toBeNull());
    await otherTab.start(pairOf(2));
    await waitFor(() => expect(a.status()).toBe('signed-in')); // this tab follows
    const leaving = a.session.signOut(); // and the investor signs out of it
    await vi.advanceTimersByTimeAsync(3_100);
    await leaving;
    expect(a.status()).toBe('signed-out');
  });

  it('clears only the sign-in it holds, never a newer one stored by another tab', async () => {
    const device = fakePlatform();
    // This tab hears nothing of the other: its store has no channel.
    const tokenStore = createTokenStore(device.storage, { channel: null });
    const clear = vi.spyOn(tokenStore, 'clear');
    const a = openTab(device, liveOver(), tokenStore);
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    const mine = await storedKey(device);
    const otherKey = await createTokenStore(device.storage, { channel: null }).start(pairOf(2));
    // A call of this tab's cannot read its session: the session ends here.
    const unreadable = () => Promise.reject(new MobileApiError('storage_error', 0));
    await a.queryClient
      .fetchQuery({ queryKey: ['live', 'x'], queryFn: unreadable })
      .catch(() => {});
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    expect(clear.mock.calls).toEqual([[mine]]);
    expect(await storedKey(device)).toBe(otherKey);
  });

  it('follows a newer sign-in it finds stored when the platform ends its own', async () => {
    const device = fakePlatform();
    let wired: ApiWiring | undefined;
    const a = openTab(
      device,
      (wiring) => {
        wired = wiring;
        return liveOver()(wiring);
      },
      createTokenStore(device.storage, { channel: null }), // hears nothing of other tabs
    );
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    const newer = await createTokenStore(device.storage, { channel: null }).start(pairOf(2));
    a.queryClient.setQueryData(['live', 'dashboard'], { of: 'the first sign-in' });
    wired?.events.onSignedOut('session_revoked'); // news of this tab's own sign-in, late
    await waitFor(() => expect(a.queryClient.getQueryData(['live', 'dashboard'])).toBeUndefined());
    await waitFor(() => expect(a.status()).toBe('signed-in'));
    expect(await storedKey(device)).toBe(newer);
  });

  it('follows a sign-in stored by the time it hears another tab sign out', async () => {
    const device = fakePlatform();
    const real = createTokenStore(device.storage, { channel: null });
    let tell: ((event: TokenStoreEvent) => void) | undefined;
    const a = openTab(device, liveOver(), {
      ...real,
      subscribe: (listener) => {
        tell = listener;
        return () => (tell = undefined);
      },
    });
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    const mine = (await storedKey(device)) ?? '';
    const newer = await createTokenStore(device.storage, { channel: null }).start(pairOf(2));
    tell?.({ type: 'clear', sessionKey: mine }); // news of a sign-out, and a sign-in since
    await vi.advanceTimersByTimeAsync(50);
    expect(a.status()).toBe('signed-in');
    expect(await storedKey(device)).toBe(newer);
  });

  it.each([
    ['cannot be read', new Error('disk error'), 0],
    ['has lost its key', new Error(UNREADABLE), 1],
  ])('ends the session when the store it checks first %s', async (_, failure, resets) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const device = fakePlatform();
    let broken = false;
    const reset = vi.fn(() => {
      broken = false; // a reset makes a new key: the store can be read again
      return device.storage.reset();
    });
    const storage = {
      ...device.storage,
      get: (key: string) => (broken ? Promise.reject(failure) : device.storage.get(key)),
      reset,
    };
    const real = createTokenStore(storage, { channel: null });
    let tell: ((event: TokenStoreEvent) => void) | undefined;
    const a = openTab({ ...device, storage }, liveOver(), {
      ...real,
      subscribe: (listener) => {
        tell = listener;
        return () => (tell = undefined);
      },
    });
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    broken = true;
    tell?.({ type: 'clear', sessionKey: 'any' }); // another tab signed out
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    expect(reset).toHaveBeenCalledTimes(resets);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ['answers', false],
    ['fails', true],
  ])('ends nothing begun here while it checked the store, whether that %s', async (_, fails) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const device = fakePlatform();
    let holding = false;
    let release!: () => void;
    const storage = {
      ...device.storage,
      get: async (key: string) => {
        if (holding && key === 'session') {
          holding = false; // only this one look waits
          await new Promise<void>((resolve) => (release = resolve));
          if (fails) throw new Error('disk error');
        }
        return device.storage.get(key);
      },
    };
    let wired: ApiWiring | undefined;
    const a = openTab(
      { ...device, storage },
      (wiring) => {
        wired = wiring;
        return liveOver()(wiring);
      },
      createTokenStore(storage, { channel: null }),
    );
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    holding = true;
    wired?.events.onSignedOut('session_revoked'); // it looks at the store first, slowly
    await waitFor(() => expect(release).toBeDefined());
    await a.session.signIn(pairOf(2)); // meanwhile the investor signs in again here
    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(a.status()).toBe('signed-in');
    expect(await storedKey(device)).not.toBeNull();
  });

  it('follows a sign-in stored just as it was about to end its session at launch', async () => {
    const device = fakePlatform();
    const deafTab = () => createTokenStore(device.storage, { channel: null });
    await deafTab().start(pairOf(1)); // a session from before the reload, with the lock on
    localStorage.setItem('app.lockEnabled', 'true');
    await device.lock.clear(); // and its lock gone: the session must end
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const storage = {
      ...device.storage,
      get: async (key: string) => {
        if (key === 'session' && ++reads === 2) await held; // a second look at the store waits
        return device.storage.get(key);
      },
    };
    const a = openTab(
      { ...device, storage },
      liveOver(),
      createTokenStore(storage, { channel: null }),
    );
    await waitFor(() => expect(reads).toBe(2));
    // Meanwhile another tab, unheard, signs in afresh: no lock, and no setting.
    localStorage.removeItem('app.lockEnabled');
    const newer = await deafTab().start(pairOf(2));
    release();
    await waitFor(() => expect(a.status()).toBe('signed-in'));
    expect(await storedKey(device)).toBe(newer);
  });

  it('follows a sign-in it finds stored when the lock it knew is gone', async () => {
    const device = fakePlatform();
    const a = openTab(device, liveOver(), createTokenStore(device.storage, { channel: null }));
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    await waitFor(() => expect(a.session.getSnapshot().lockSetup).not.toBeNull());
    a.session.enrolDevice(); // the investor sets up the device's own lock
    await waitFor(() => expect(a.session.getSnapshot().lockMethod).toBe('webauthn'));
    // Another tab, unheard, signs out and in again: the lock and its setting go.
    await device.lock.clear();
    localStorage.removeItem('app.lockEnabled');
    const newer = await createTokenStore(device.storage, { channel: null }).start(pairOf(2));
    a.session.lock(); // Lock now: the lock is found gone
    await waitFor(() => expect(a.status()).toBe('signed-in'));
    expect(await storedKey(device)).toBe(newer);
  });
});

describe('AppSession: a step that answers after the session changed', () => {
  /** The sample world, wired to the session's callbacks; `api` is kept for the spec. */
  function sampleOver(api = createSampleApi({ latencyMs: 0 })) {
    return (wiring: ApiWiring) => {
      api = createSampleApi({ latencyMs: 0, onSignedOut: wiring.events.onSignedOut });
      return api;
    };
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['answers', false],
    ['fails', true],
  ])(
    'never ends a sign-in made while the launch read the store, which then %s',
    async (_, fails) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const device = fakePlatform();
      const held = gate();
      let first = true;
      const storage = {
        ...device.storage,
        get: async (key: string) => {
          if (first && key === 'session') {
            first = false; // the launch's look at the store waits
            await held.opened;
            if (fails) throw new Error('disk error');
            return null;
          }
          return device.storage.get(key);
        },
      };
      const a = openTab({ ...device, storage }, liveOver(), createTokenStore(storage));
      expect(a.status()).toBe('loading');
      await a.session.signIn(pairOf(1)); // the investor signs in meanwhile
      expect(a.status()).toBe('signed-in');
      held.release();
      await vi.advanceTimersByTimeAsync(50);
      expect(a.status()).toBe('signed-in');
    },
  );

  it('never shows the lock when the launch’s look at it answers after the end', async () => {
    sessionStorage.setItem('app.sample', '1'); // a session from before the reload
    let answer!: (method: 'webauthn') => void;
    const enrolled = () => new Promise<'webauthn'>((resolve) => (answer = resolve));
    let wired: ApiWiring | undefined;
    const a = openTab(fakePlatform({ lock: { enrolled } }), (wiring) => {
      wired = wiring;
      return sampleOver()(wiring);
    });
    await waitFor(() => expect(answer).toBeDefined());
    wired?.events.onSignedOut('session_revoked'); // the platform ends it meanwhile
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    answer('webauthn');
    await vi.advanceTimersByTimeAsync(50);
    expect(a.status()).toBe('signed-out');
  });

  it('stays signed out when the session ends while a sign-in wipes the old lock', async () => {
    const held = gate();
    let first = true;
    const clear = () => {
      if (!first) return Promise.resolve();
      first = false;
      return held.opened;
    };
    let wired: ApiWiring | undefined;
    const a = openTab(fakePlatform({ lock: { clear } }), (wiring) => {
      wired = wiring;
      return sampleOver()(wiring);
    });
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    const signingIn = a.session.enterSample(); // it waits on wiping the old lock
    await vi.advanceTimersByTimeAsync(10);
    wired?.events.onSignedOut('session_revoked'); // and the session ends meanwhile
    await vi.advanceTimersByTimeAsync(10);
    held.release();
    await signingIn;
    expect(a.status()).toBe('signed-out');
    expect(sessionStorage.getItem('app.sample')).toBeNull();
  });

  it('leaves the app signed out when the session ends while a sign-in is stored', async () => {
    const device = fakePlatform();
    const held = gate();
    let holding = false;
    const storage = {
      ...device.storage,
      set: async (key: string, value: string) => {
        if (holding && key === 'session') await held.opened;
        return device.storage.set(key, value);
      },
    };
    let wired: ApiWiring | undefined;
    const a = openTab(
      { ...device, storage },
      (wiring) => {
        wired = wiring;
        return liveOver()(wiring);
      },
      createTokenStore(storage),
    );
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    holding = true;
    const signingIn = a.session.signIn(pairOf(1)); // storing the session waits
    await vi.advanceTimersByTimeAsync(10);
    wired?.events.onSignedOut('session_revoked'); // and the session ends meanwhile
    await waitFor(() => expect(a.session.getSnapshot().status).toBe('signed-out'));
    held.release();
    await signingIn;
    await vi.advanceTimersByTimeAsync(10);
    expect(a.status()).toBe('signed-out');
  });

  it.each([
    ['says yes', true],
    ['says no', false],
  ])(
    'never opens, nor complains, when the device %s while the investor signs out',
    async (_, ok) => {
      sessionStorage.setItem('app.sample', '1');
      let answer!: (ok: boolean) => void;
      const verify = () => new Promise<boolean>((resolve) => (answer = resolve));
      const api = createSampleApi({ latencyMs: 0 });
      vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined)); // slow platform
      const a = openTab(fakePlatform({ lock: { verify } }), () => api);
      await waitFor(() => expect(a.status()).toBe('locked'));
      void a.session.unlock(); // the device prompt is up
      void a.session.signOut(); // and the investor signs out instead
      answer(ok);
      await vi.advanceTimersByTimeAsync(50);
      expect(a.status()).toBe('locked');
      expect(a.session.getSnapshot().unlocking.error).toBeUndefined();
    },
  );

  it('never opens when the platform answers the unlock during a sign-out', async () => {
    sessionStorage.setItem('app.sample', '1');
    const api = createSampleApi({ latencyMs: 0 });
    const me = await api.me();
    let answer!: () => void;
    vi.spyOn(api, 'me').mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve(me))),
    );
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const a = openTab(fakePlatform(), () => api);
    await waitFor(() => expect(a.status()).toBe('locked'));
    void a.session.unlock(); // the device says yes, and the platform is asked
    await waitFor(() => expect(answer).toBeDefined());
    void a.session.signOut(); // and the investor signs out instead
    answer();
    await vi.advanceTimersByTimeAsync(50);
    expect(a.status()).toBe('locked');
  });

  it('never shows the lock’s error when its check fails during a sign-out', async () => {
    sessionStorage.setItem('app.sample', '1');
    let fail!: (error: Error) => void;
    const verify = () => new Promise<boolean>((_, reject) => (fail = reject));
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const a = openTab(fakePlatform({ lock: { verify } }), () => api);
    await waitFor(() => expect(a.status()).toBe('locked'));
    void a.session.unlock();
    void a.session.signOut();
    fail(new Error('NotReadableError'));
    await vi.advanceTimersByTimeAsync(50);
    expect(a.session.getSnapshot().unlocking.error).toBeUndefined();
  });

  it('offers no lock when the device answers what it offers during a sign-out', async () => {
    let offer!: (method: 'webauthn') => void;
    const available = () => new Promise<'webauthn'>((resolve) => (offer = resolve));
    const api = createSampleApi({ latencyMs: 0 });
    vi.spyOn(api, 'logout').mockReturnValue(new Promise<void>(() => undefined));
    const a = openTab(fakePlatform({ lock: { available } }), () => api);
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.enterSample();
    await waitFor(() => expect(offer).toBeDefined());
    void a.session.signOut();
    offer('webauthn');
    await vi.advanceTimersByTimeAsync(50);
    expect(a.session.getSnapshot().lockSetup).toBeNull();
  });
});

describe('AppSession: ending and starting sessions in one visit', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A tab signed in to the sample world, with no lock: `wired` reaches its callbacks. */
  async function signedInTab(device = fakePlatform()) {
    const api = createSampleApi({ latencyMs: 0 });
    let wired: ApiWiring | undefined;
    const tab = openTab(device, (wiring) => {
      wired = wiring;
      return api;
    });
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    await tab.session.enterSample();
    tab.session.skipLockSetup();
    return { ...tab, api, onSignedOut: () => wired?.events.onSignedOut('session_revoked') };
  }

  it('tells the platform once when the investor taps Sign out twice', async () => {
    const tab = await signedInTab();
    const logout = vi.spyOn(tab.api, 'logout');
    await Promise.all([tab.session.signOut(), tab.session.signOut()]);
    expect(tab.status()).toBe('signed-out');
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('clears the device once when the platform ends the session twice over', async () => {
    const device = fakePlatform();
    const tab = await signedInTab(device);
    const clear = vi.spyOn(device.lock, 'clear');
    tab.onSignedOut();
    tab.onSignedOut();
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signs out', (tab: Awaited<ReturnType<typeof signedInTab>>) => tab.session.signOut()],
    [
      'is signed out by the platform',
      (tab: Awaited<ReturnType<typeof signedInTab>>) => tab.onSignedOut(),
    ],
  ])('forgets everything it fetched when the investor %s', async (_, end) => {
    const tab = await signedInTab();
    tab.queryClient.setQueryData(['sample', 'dashboard'], { of: 'the investor' });
    void end(tab);
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    expect(tab.queryClient.getQueryData(['sample', 'dashboard'])).toBeUndefined();
  });

  it('forgets everything it fetched when another tab signs in as someone else', async () => {
    const device = fakePlatform();
    const a = openTab(device, liveOver());
    const otherTab = createTokenStore(device.storage);
    stops.push(otherTab.subscribe(() => {}));
    await waitFor(() => expect(a.status()).toBe('signed-out'));
    await a.session.signIn(pairOf(1));
    a.queryClient.setQueryData(['live', 'dashboard'], { of: 'the first investor' });
    await otherTab.start(pairOf(2));
    await waitFor(() => expect(a.queryClient.getQueryData(['live', 'dashboard'])).toBeUndefined());
    await waitFor(() => expect(a.status()).toBe('signed-in'));
  });

  it('can sign out, sign in and sign out again, telling the platform each time', async () => {
    const tab = await signedInTab();
    const logout = vi.spyOn(tab.api, 'logout');
    await tab.session.signOut();
    await tab.session.enterSample();
    expect(tab.status()).toBe('signed-in');
    await tab.session.signOut();
    expect(tab.status()).toBe('signed-out');
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('can be signed out by the platform in a second session of the same visit', async () => {
    const tab = await signedInTab();
    tab.onSignedOut();
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    await tab.session.enterSample();
    expect(tab.status()).toBe('signed-in');
    tab.onSignedOut();
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
  });

  it('never lets a late answer of the device approve a later confirmation', async () => {
    const answers: ((ok: boolean) => void)[] = [];
    const verify = () => new Promise<boolean>((resolve) => answers.push(resolve));
    const tab = await signedInTab(fakePlatform({ lock: { verify } }));
    const settingUp = tab.session.setLockEnabled(true); // the investor sets up the device's lock
    await waitFor(() => expect(tab.session.getSnapshot().lockSetup).not.toBeNull());
    tab.session.enrolDevice();
    expect(await settingUp).toBe(true);
    const first = tab.session.confirm('Send $10.00 to $grace');
    await waitFor(() => expect(tab.session.getSnapshot().confirmation).not.toBeNull());
    tab.session.confirmWith(); // the device prompt is up
    const second = tab.session.confirm('Send $20.00 to $grace'); // a newer one replaces it
    expect(await first).toBe(false);
    await waitFor(() => expect(tab.session.getSnapshot().confirmation?.reason).toMatch(/\$20/));
    answers[0]?.(true); // the first prompt is answered, late
    await vi.advanceTimersByTimeAsync(50);
    expect(tab.session.getSnapshot().confirmation?.reason).toMatch(/\$20/);
    tab.session.confirmWith();
    answers[1]?.(true);
    expect(await second).toBe(true);
  });
});

describe('AppSession: the passcode’s last attempt', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['a newer confirmation replaces it', 'replace'],
    ['the app locks', 'lock'],
  ] as const)('signs out after the fifth wrong passcode, though %s meanwhile', async (_, then) => {
    let answer!: (result: { ok: boolean; attemptsLeft: number }) => void;
    const device = fakePlatform({ lock: { available: () => Promise.resolve('passcode') } });
    const tab = openTab(device, () => createSampleApi({ latencyMs: 0 }));
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    await tab.session.enterSample();
    await waitFor(() => expect(tab.session.getSnapshot().lockSetup).not.toBeNull());
    tab.session.enrolPasscode('246810'); // the investor sets a passcode
    await waitFor(() => expect(tab.session.getSnapshot().lockMethod).toBe('passcode'));
    device.lock.verifyPasscode = () => new Promise((resolve) => (answer = resolve));
    const first = tab.session.confirm('Send $10.00 to $grace');
    await waitFor(() => expect(tab.session.getSnapshot().confirmation).not.toBeNull());
    tab.session.confirmWith('000000'); // the fifth wrong passcode in a row is checked
    if (then === 'replace') void tab.session.confirm('Send $20.00 to $grace');
    else tab.session.lock();
    expect(await first).toBe(false);
    answer({ ok: false, attemptsLeft: 0 });
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
  });

  it('never signs out a sign-in it followed while the last passcode was checked', async () => {
    let answer!: (result: { ok: boolean; attemptsLeft: number }) => void;
    const device = fakePlatform({ lock: { available: () => Promise.resolve('passcode') } });
    const tab = openTab(device, liveOver());
    const otherTab = createTokenStore(device.storage);
    stops.push(otherTab.subscribe(() => {}));
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    await tab.session.signIn(pairOf(1));
    await waitFor(() => expect(tab.session.getSnapshot().lockSetup).not.toBeNull());
    tab.session.enrolPasscode('246810');
    await waitFor(() => expect(tab.session.getSnapshot().lockMethod).toBe('passcode'));
    device.lock.verifyPasscode = () => new Promise((resolve) => (answer = resolve));
    void tab.session.confirm('Send $10.00 to $grace');
    await waitFor(() => expect(tab.session.getSnapshot().confirmation).not.toBeNull());
    tab.session.confirmWith('000000');
    await otherTab.start(pairOf(2)); // a new sign-in in another tab: this one follows it
    await waitFor(() => expect(tab.status()).toBe('locked'));
    answer({ ok: false, attemptsLeft: 0 }); // the old check answers late
    await vi.advanceTimersByTimeAsync(50);
    expect(tab.status()).toBe('locked');
  });
});

describe('AppSession: a lock set up after its offer closed', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A tab signed in to the sample world whose passcode setup waits until release(). */
  async function settingUpSlowly() {
    const device = fakePlatform({ lock: { available: () => Promise.resolve('passcode') } });
    const enrol = device.lock.enrollPasscode.bind(device.lock);
    const held = gate();
    device.lock.enrollPasscode = (code) => held.opened.then(() => enrol(code));
    let wired: ApiWiring | undefined;
    const tab = openTab(device, (wiring) => {
      wired = wiring;
      return createSampleApi({ latencyMs: 0 });
    });
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    await tab.session.enterSample();
    await waitFor(() => expect(tab.session.getSnapshot().lockSetup).not.toBeNull());
    tab.session.enrolPasscode('246810'); // the passcode is being saved
    return { ...tab, device, release: held.release, events: () => wired?.events };
  }

  it('records the lock all the same', async () => {
    const tab = await settingUpSlowly();
    tab.events()?.onUpgradeRequired('2.0.0'); // the update screen closes the offer meanwhile
    expect(tab.session.getSnapshot().lockSetup).toBeNull();
    tab.release();
    await waitFor(() => expect(tab.session.getSnapshot().lockMethod).toBe('passcode'));
    expect(tab.session.getSnapshot().lockChoice).toBe(true);
    expect(localStorage.getItem('app.lockEnabled')).toBe('true');
  });

  it('records no lock for a session that ended meanwhile', async () => {
    const tab = await settingUpSlowly();
    tab.events()?.onSignedOut('session_revoked');
    await waitFor(() => expect(tab.status()).toBe('signed-out'));
    tab.release();
    await vi.advanceTimersByTimeAsync(50);
    expect(tab.session.getSnapshot().lockMethod).toBeNull();
    expect(localStorage.getItem('app.lockEnabled')).toBeNull();
  });
});
