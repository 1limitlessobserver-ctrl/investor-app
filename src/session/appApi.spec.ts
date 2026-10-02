import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SampleApi } from '../api/createSampleApi';
import { createSecureStorage } from '../platform/web/storage';
import { memoryKvStore } from '../test/memoryKvStore';
import { createAppApi } from './appApi';
import { readAppConfig } from './appConfig';
import type { ApiWiring } from './sessionController';
import { createTokenStore } from './tokens';

function wiring() {
  return {
    events: { onSignedOut: vi.fn(), onUpgradeRequired: vi.fn(), onStorageError: vi.fn() },
    tokenStore: createTokenStore(createSecureStorage({ db: memoryKvStore() }), { channel: null }),
  } satisfies ApiWiring;
}

const CHROME_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/129.0.0.0 Safari/537.36';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('createAppApi', () => {
  it('serves the sample world, with the address’s options, when no platform is named', async () => {
    const wired = wiring();
    const api = createAppApi(wired, {
      config: readAppConfig({}, '0.1.0'),
      search: '?sampleMinVersion=99.0.0&sampleLatency=0',
      userAgent: CHROME_ON_WINDOWS,
    });
    expect(api.mode).toBe('sample');
    expect((await api.brand()).minSupportedAppVersion).toBe('99.0.0');
    (api as SampleApi)._test_revoke();
    await expect(api.me()).rejects.toMatchObject({ code: 'session_revoked' });
    expect(wired.events.onSignedOut).toHaveBeenCalledWith('session_revoked');
  });

  it('talks to the company’s platform, naming the app and this device', async () => {
    localStorage.setItem('app.deviceId', 'install-id-1234');
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: 'upgrade_required', minSupportedAppVersion: '2.0.0' }),
          {
            status: 426,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const wired = wiring();
    const api = createAppApi(wired, {
      config: readAppConfig({ VITE_PLATFORM_URL: 'https://invest.example.com' }, '1.4.2'),
      search: '?sampleMinVersion=99.0.0',
      userAgent: CHROME_ON_WINDOWS,
    });
    expect(api.mode).toBe('live');
    await expect(api.brand()).rejects.toMatchObject({ code: 'upgrade_required' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://invest.example.com/api/mobile/v1/brand');
    expect(init.headers).toMatchObject({
      'X-App-Version': '1.4.2',
      'X-App-Platform': 'web',
      'X-Device-Id': 'install-id-1234',
      'X-Device-Name': 'Chrome%20on%20Windows',
    });
    expect(wired.events.onUpgradeRequired).toHaveBeenCalledWith('2.0.0');
  });

  it('refuses a platform address the client cannot use', () => {
    expect(() =>
      createAppApi(wiring(), {
        config: readAppConfig({ VITE_PLATFORM_URL: 'ftp://invest.example.com' }, '1.0.0'),
        search: '',
        userAgent: '',
      }),
    ).toThrow(TypeError);
  });
});
