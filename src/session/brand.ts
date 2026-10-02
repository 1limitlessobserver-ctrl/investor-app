// The company's brand on this device: GET /brand cached in localStorage (`app.brand`, public data
// only) so the sign-in screen and an offline launch show the company before the platform answers,
// and the appearance it gives the app: the theme (the investor's choice in `app.theme`, else the
// brand's default) and the accent that themes.apply() paints.

import type { Brand } from '../api/types';
import { themes, type ThemeId } from '../design/themes';
import { appConfig } from './appConfig';

const BRAND_KEY = 'app.brand';
const THEME_KEY = 'app.theme';
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: as if nothing were kept
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the app works on without it.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown) => value === null || isText(value);
const isThemeId = (value: unknown): value is ThemeId => themes.ids.some((id) => id === value);

/** Every key of `keys` in `value` passes `check`. */
const all = (value: unknown, keys: readonly string[], check: (v: unknown) => boolean) =>
  isRecord(value) && keys.every((key) => check(value[key]));

/**
 * A whole Brand, as GET /brand answers it, in a shape this version can use: a cached one must be,
 * or it is not used, and so must one the platform sends (identity.ts).
 */
export function isBrand(value: unknown): value is Brand {
  return (
    isRecord(value) &&
    value.apiVersion === 1 &&
    all(value, ['name', 'tagline', 'accentHex', 'minSupportedAppVersion'], isText) &&
    isTextOrNull(value.logoDataUrl) &&
    isThemeId(value.defaultTheme) &&
    Array.isArray(value.themes) &&
    value.themes.every(isThemeId) &&
    all(value.features, ['kyc', 'deposits', 'oracle', 'support'], (v) => typeof v === 'boolean') &&
    all(value.stores, ['appStore', 'googlePlay', 'androidDirect'], isTextOrNull) &&
    all(value.links, ['website', 'privacy', 'terms', 'register', 'forgotPassword'], isText) &&
    all(value.support, ['email'], isText) &&
    all(value.support, ['phone'], isTextOrNull) &&
    (value.vapidPublicKey === undefined || isText(value.vapidPublicKey))
  );
}

/**
 * The last brand the platform sent, kept with the app version and the platform that kept it:
 * another version may read a brand differently, and another platform is another company (or the
 * sample), so either starts afresh.
 */
export const brandCache = {
  read(): Brand | null {
    const raw = readItem(BRAND_KEY);
    if (raw === null) return null;
    try {
      const kept: unknown = JSON.parse(raw);
      if (
        !isRecord(kept) ||
        kept.appVersion !== appConfig.appVersion ||
        kept.platformUrl !== appConfig.platformUrl
      ) {
        return null;
      }
      return isBrand(kept.brand) ? kept.brand : null;
    } catch {
      return null;
    }
  },
  write(brand: Brand): void {
    const { appVersion, platformUrl } = appConfig;
    writeItem(BRAND_KEY, JSON.stringify({ appVersion, platformUrl, brand }));
  },
};

/** The theme the investor picked on this device, if any. */
export const themeChoice = {
  read(): ThemeId | null {
    const id = readItem(THEME_KEY);
    return isThemeId(id) ? id : null;
  },
  write(id: ThemeId): void {
    writeItem(THEME_KEY, id);
  },
};

/**
 * The theme to show: the investor's choice, else the brand's default, else Orbital (also for a
 * default this version does not know).
 */
export function themeFor(choice: ThemeId | null, brand: Brand | null): ThemeId {
  return choice ?? (isThemeId(brand?.defaultTheme) ? brand.defaultTheme : 'orbital');
}

/** The accent to paint: the brand's when it is a colour, else the install-time one. */
export function accentFor(brand: Brand | null, fallback: string): string {
  return brand && HEX_COLOUR.test(brand.accentHex) ? brand.accentHex : fallback;
}
