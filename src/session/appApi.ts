// The PlatformApi the app talks to, made once at launch: the sample world when the build names no
// platform (with the address's sample options, and the company the build was made for as its
// brand's name and accent), else the live client for the company's platform, naming the app and
// this device on every request and answering to the session's callbacks.

import { createLiveApi } from '../api/createLiveApi';
import { createSampleApi } from '../api/createSampleApi';
import type { PlatformApi } from '../api/PlatformApi';
import { appConfig, type AppConfig } from './appConfig';
import { getDeviceId } from './deviceId';
import { deviceName } from './deviceName';
import { readSampleOptions } from './sampleOptions';
import type { ApiWiring } from './sessionController';

export interface AppApiContext {
  config: AppConfig;
  /** The address's query string, read for the sample options. */
  search: string;
  userAgent: string;
}

function browserContext(): AppApiContext {
  return { config: appConfig, search: window.location.search, userAgent: navigator.userAgent };
}

/**
 * The app's API. The live client refuses a configuration it cannot send (a TypeError): the app
 * shows that as a setup problem rather than retrying.
 */
export function createAppApi(
  { events, tokenStore }: ApiWiring,
  context: AppApiContext = browserContext(),
): PlatformApi {
  const { config, search, userAgent } = context;
  if (config.platformUrl === '') {
    // A build without the company's files (the dev server) keeps the sample world's own company.
    const company = config.productName
      ? { name: config.productName, accentHex: config.accentFallback }
      : undefined;
    return createSampleApi({
      ...readSampleOptions(search),
      company,
      onSignedOut: events.onSignedOut,
    });
  }
  return createLiveApi({
    baseUrl: `${config.platformUrl}/api/mobile/v1`,
    tokenStore,
    app: {
      version: config.appVersion,
      platform: 'web',
      deviceId: getDeviceId(),
      deviceName: deviceName(userAgent),
    },
    onSignedOut: events.onSignedOut,
    onUpgradeRequired: events.onUpgradeRequired,
    onStorageError: events.onStorageError,
  });
}
