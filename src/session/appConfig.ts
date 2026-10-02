// What the app knows about its company before it has asked the platform anything: the values
// scripts/apply-company.ts writes from company.config.json into .env.production (VITE_*), and the
// package.json version the build defines as __APP_VERSION__. Everything else about the company
// (name, accent, logo, theme, links) comes from GET /brand at run time.

import { themes } from '../design/themes';

export interface AppConfig {
  /** The platform's origin without a trailing slash; '' is sample mode. */
  platformUrl: string;
  /** The install-time name, shown until the brand is known; '' when the build did not say. */
  productName: string;
  shortName: string;
  /** The accent to paint before the brand is known: "#RRGGBB". */
  accentFallback: string;
  /** X-App-Version: the package.json version. */
  appVersion: string;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The config from the build's environment. A missing or blank platform URL is sample mode, and an
 * accent that is not "#RRGGBB" gives way to Orbital's own, so the first paint always has a colour.
 */
export function readAppConfig(env: Record<string, unknown>, appVersion: string): AppConfig {
  const accent = text(env.VITE_ACCENT_FALLBACK);
  return {
    platformUrl: text(env.VITE_PLATFORM_URL).replace(/\/+$/, ''),
    productName: text(env.VITE_PRODUCT_NAME),
    shortName: text(env.VITE_SHORT_NAME),
    accentFallback: HEX_COLOUR.test(accent) ? accent : themes.tokens('orbital').signatureAccent,
    appVersion,
  };
}

export const appConfig: AppConfig = readAppConfig(import.meta.env, __APP_VERSION__);
