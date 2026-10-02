import { render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { createSampleApi, type SampleApiOptions } from '../api/createSampleApi';
import { App } from '../app/App';
import { AppProviders } from '../app/providers';
import { routes } from '../app/router';
import { useAppSession, type SessionEvents } from '../session/AppSession';
import { stubRadixBrowserApis } from './browserStubs';
import { FAKE_PASSCODE, fakePlatform, type PlatformOverrides } from './fakePlatform';

export interface RenderWithAppOptions {
  /** Where the app opens, such as '/move/transfer' or '/portfolio?tab=statements'. */
  route: string;
  /**
   * Opens on a sample session stored from before, as after a reload: locked behind the device's
   * lock, which is then unlocked (the device's prompt, or the fake passcode).
   */
  signedIn?: boolean | undefined;
  /** How long every sample call waits; 0 unless set. */
  latencyMs?: number | undefined;
  /** Device adapters to replace, per adapter: `{ share: { files } }`. */
  platform?: PlatformOverrides | undefined;
  /** More options for the sample world, such as `minSupportedAppVersion`. */
  sample?: Omit<SampleApiOptions, 'latencyMs' | 'onSignedOut'> | undefined;
}

/** Unlocks the stored session once, when the app opens locked. */
function UnlockOnce() {
  const { status, lockMethod, unlock } = useAppSession();
  const done = useRef(false);
  useEffect(() => {
    if (status !== 'locked' || lockMethod === null || done.current) return;
    done.current = true;
    void unlock(lockMethod === 'passcode' ? FAKE_PASSCODE : undefined);
  }, [status, lockMethod, unlock]);
  return null;
}

/**
 * Renders the whole app for a screen spec: the real providers and routes over a fresh sample world
 * (`latencyMs` 0) and fakePlatform(), in a memory router at `route`. With `signedIn`, the app opens
 * on a stored sample session and unlocks it with the fake lock (set up by default), so the screen
 * at `route` shows signed in, with the lock on. jsdom's missing browser APIs (Radix's, the
 * starfield's canvas) are stubbed. Returns the sample api (to change its world: `_test_revoke()`)
 * and the router (`router.state.location`).
 */
export function renderWithApp({
  route,
  signedIn = false,
  latencyMs = 0,
  platform,
  sample,
}: RenderWithAppOptions) {
  stubRadixBrowserApis();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  if (signedIn) sessionStorage.setItem('app.sample', '1');
  let events: SessionEvents | undefined;
  const api = createSampleApi({
    ...sample,
    latencyMs,
    onSignedOut: (reason) => events?.onSignedOut(reason),
  });
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const view = render(
    <AppProviders
      api={(wiring) => {
        events = wiring.events;
        return api;
      }}
      platform={fakePlatform(platform)}
    >
      <App router={router} />
      {signedIn && <UnlockOnce />}
    </AppProviders>,
  );
  return { ...view, api, router };
}
