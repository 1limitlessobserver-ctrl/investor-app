import { render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { LiveApi } from '../api/createLiveApi';
import { createSampleApi, type SampleApi, type SampleApiOptions } from '../api/createSampleApi';
import { App } from '../app/App';
import { AppProviders } from '../app/providers';
import { routes } from '../app/router';
import { useAppSession, type SessionEvents } from '../session/AppSession';
import { stubRadixBrowserApis } from './browserStubs';
import { FAKE_PASSCODE, fakePlatform, type PlatformOverrides } from './fakePlatform';
import { liveApi, type LiveApiOptions } from './liveApi';

export interface RenderWithAppOptions {
  /** Where the app opens, such as '/move/transfer' or '/portfolio?tab=statements'. */
  route: string;
  /**
   * The build: 'sample' (the default) over a fresh sample world, or 'live' over the live client
   * and a stand-in platform (src/test/liveApi.ts; `live` says how it answers). A live build opens
   * signed out.
   */
  mode?: 'sample' | 'live' | undefined;
  /** For a live build: how the stand-in platform answers. */
  live?: LiveApiOptions | undefined;
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

type Rendered<Api> = ReturnType<typeof render> & {
  api: Api;
  router: ReturnType<typeof createMemoryRouter>;
};

/**
 * Renders the whole app for a screen spec: the real providers and routes over a fresh sample world
 * (`latencyMs` 0) and fakePlatform(), in a memory router at `route`. With `signedIn`, the app opens
 * on a stored sample session and unlocks it with the fake lock (set up by default), so the screen
 * at `route` shows signed in, with the lock on. jsdom's missing browser APIs (Radix's, the
 * starfield's canvas) are stubbed. Returns the api (the sample one can change its world:
 * `_test_revoke()`) and the router (`router.state.location`). With `mode: 'live'` the app is a live
 * build over a stand-in platform, opening signed out.
 */
export function renderWithApp(
  options: RenderWithAppOptions & { mode?: 'sample' | undefined },
): Rendered<SampleApi>;
export function renderWithApp(options: RenderWithAppOptions & { mode: 'live' }): Rendered<LiveApi>;
export function renderWithApp({
  route,
  mode = 'sample',
  live,
  signedIn = false,
  latencyMs = 0,
  platform,
  sample,
}: RenderWithAppOptions): Rendered<SampleApi | LiveApi> {
  if (mode === 'live' && signedIn) throw new Error('renderWithApp: a live build opens signed out.');
  stubRadixBrowserApis();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  if (signedIn) sessionStorage.setItem('app.sample', '1');
  let events: SessionEvents | undefined;
  let api: SampleApi | LiveApi | undefined;
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const view = render(
    <AppProviders
      api={(wiring) => {
        events = wiring.events;
        api =
          mode === 'live'
            ? liveApi(live)(wiring)
            : createSampleApi({
                ...sample,
                latencyMs,
                onSignedOut: (reason) => events?.onSignedOut(reason),
              });
        return api;
      }}
      platform={fakePlatform(platform)}
    >
      <App router={router} />
      {signedIn && <UnlockOnce />}
    </AppProviders>,
  );
  if (api === undefined) throw new Error('renderWithApp: the app made no api.');
  return { ...view, api, router };
}
