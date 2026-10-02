import { createLiveApi, type LiveApi } from '../api/createLiveApi';
import { createSampleApi } from '../api/createSampleApi';
import type { ApiWiring } from '../session/sessionController';

/** Where the stand-in platform serves the mobile API. */
export const PLATFORM_ROOT = 'https://platform.test/api/mobile/v1';

export interface LiveApiOptions {
  /** POST /auth/logout never answers, as on a slow network. */
  slowLogout?: boolean | undefined;
  /**
   * Answers a request in the stand-in's place: `path` is the route under PLATFORM_ROOT, such as
   * '/brand'. Undefined leaves the request to the stand-in.
   */
  answer?: ((path: string) => Promise<Response> | undefined) | undefined;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * The live client, wired to the session (pass it as AppSessionProvider's `api`), over a stand-in
 * platform for specs: GET /brand answers a fresh sample world's brand, POST /auth/logout answers
 * `{ ok: true }`, and every other call answers that world's GET /me.
 */
export function liveApi(options: LiveApiOptions = {}) {
  return ({ events, tokenStore }: ApiWiring): LiveApi => {
    const sample = createSampleApi({ latencyMs: 0 });
    return createLiveApi({
      baseUrl: PLATFORM_ROOT,
      tokenStore,
      app: { version: '1.0.0', platform: 'web', deviceId: 'device-test-1' },
      fetchImpl: async (input) => {
        const path = urlOf(input).slice(PLATFORM_ROOT.length).split('?')[0] ?? '';
        const answered = options.answer?.(path);
        if (answered !== undefined) return answered;
        if (path === '/auth/logout') {
          return options.slowLogout ? new Promise<Response>(() => {}) : json({ ok: true });
        }
        return json(path === '/brand' ? await sample.brand() : await sample.me());
      },
      ...events,
    });
  };
}
