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
import { fakePlatform, type PlatformOverrides } from './fakePlatform';

export interface RenderWithAppOptions {
  /** Where the app opens, such as '/move/transfer' or '/portfolio?tab=statements'. */
  route: string;
  /** Enters the sample session first, as "Explore with sample data" does. */
  signedIn?: boolean | undefined;
  /** How long every sample call waits; 0 unless set. */
  latencyMs?: number | undefined;
  /** Device adapters to replace, per adapter: `{ share: { files } }`. */
  platform?: PlatformOverrides | undefined;
  /** More options for the sample world, such as `minSupportedAppVersion`. */
  sample?: Omit<SampleApiOptions, 'latencyMs' | 'onSignedOut'> | undefined;
}

/** Signs in to the sample world once the session has started signed out. */
function EnterSample() {
  const { status, enterSample } = useAppSession();
  const entered = useRef(false);
  useEffect(() => {
    if (status !== 'signed-out' || entered.current) return;
    entered.current = true;
    void enterSample();
  }, [status, enterSample]);
  return null;
}

/**
 * Renders the whole app for a screen spec: the real providers and routes over a fresh sample world
 * (`latencyMs` 0) and fakePlatform(), in a memory router at `route`. With `signedIn`, the sample
 * session is entered first: the visitor is sent to sign-in and back to `route` once signed in.
 * jsdom's missing browser APIs (Radix's, the starfield's canvas) are stubbed. Returns the sample
 * api (to change its world: `_test_revoke()`) and the router (`router.state.location`).
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
      {signedIn && <EnterSample />}
    </AppProviders>,
  );
  return { ...view, api, router };
}
