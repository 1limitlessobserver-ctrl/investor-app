import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '../api/types';
import { sampleData } from '../sample/sampleData';
import { appConfig } from './appConfig';
import { accentFor, brandCache, isBrand, themeChoice, themeFor } from './brand';

const brand = (): Brand => structuredClone(sampleData.createState().brand);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('brandCache', () => {
  it('keeps the brand on this device for the next launch', () => {
    expect(brandCache.read()).toBeNull();
    const b = brand();
    brandCache.write(b);
    expect(brandCache.read()).toEqual(b);
  });

  it('forgets a brand cached by another version of the app', () => {
    localStorage.setItem(
      'app.brand',
      JSON.stringify({ appVersion: '0.0.0-old', platformUrl: '', brand: brand() }),
    );
    expect(brandCache.read()).toBeNull();
  });

  it('forgets a brand cached from another platform', () => {
    localStorage.setItem(
      'app.brand',
      JSON.stringify({
        appVersion: appConfig.appVersion,
        platformUrl: 'https://other.example.com',
        brand: brand(),
      }),
    );
    expect(brandCache.read()).toBeNull();
  });

  it('reads anything that is not a whole brand as none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cached = (value: unknown) =>
      localStorage.setItem(
        'app.brand',
        JSON.stringify({ appVersion: appConfig.appVersion, platformUrl: '', brand: value }),
      );
    for (const broken of [
      null,
      'Everest',
      { ...brand(), name: 42 },
      { ...brand(), defaultTheme: 'neon' },
      { ...brand(), features: { kyc: true } },
      { ...brand(), links: null },
      { ...brand(), apiVersion: 2 },
    ]) {
      cached(broken);
      expect(brandCache.read()).toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
    localStorage.setItem('app.brand', '{not json');
    expect(brandCache.read()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[investor-app] reading the cached brand:',
      expect.any(SyntaxError),
    );
  });

  it('carries on without the cache when storage is blocked, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => brandCache.write(brand())).not.toThrow();
    expect(brandCache.read()).toBeNull();
    expect(warn).toHaveBeenCalledWith('[investor-app] saving app.brand:', expect.any(DOMException));
    expect(warn).toHaveBeenCalledWith(
      '[investor-app] reading app.brand:',
      expect.any(DOMException),
    );
  });
});

describe('isBrand', () => {
  it('knows a whole brand, as GET /brand answers it', () => {
    expect(isBrand(brand())).toBe(true);
    expect(isBrand({ ...brand(), vapidPublicKey: 'BKey' })).toBe(true);
    for (const broken of [
      null,
      { ...brand(), minSupportedAppVersion: null },
      { ...brand(), defaultTheme: 'nebula' },
      { ...brand(), themes: ['orbital', 'nebula'] },
      { ...brand(), vapidPublicKey: 42 },
    ]) {
      expect(isBrand(broken)).toBe(false);
    }
  });
});

describe('themeChoice', () => {
  it('remembers a theme the investor picked, and only a theme', () => {
    expect(themeChoice.read()).toBeNull();
    themeChoice.write('ivory');
    expect(localStorage.getItem('app.theme')).toBe('ivory');
    expect(themeChoice.read()).toBe('ivory');
    localStorage.setItem('app.theme', 'neon');
    expect(themeChoice.read()).toBeNull();
  });
});

describe('themeFor', () => {
  it('shows the investor’s choice, else the brand’s default, else Orbital', () => {
    expect(themeFor('aegis', { ...brand(), defaultTheme: 'verdant' })).toBe('aegis');
    expect(themeFor(null, { ...brand(), defaultTheme: 'verdant' })).toBe('verdant');
    expect(themeFor(null, null)).toBe('orbital');
  });

  it('shows Orbital for a default theme this version does not know', () => {
    expect(themeFor(null, { ...brand(), defaultTheme: 'nebula' as never })).toBe('orbital');
  });
});

describe('accentFor', () => {
  it('paints the brand’s accent when it is a colour, else the install-time one', () => {
    expect(accentFor({ ...brand(), accentHex: '#1F9E76' }, '#6EA8FF')).toBe('#1F9E76');
    expect(accentFor({ ...brand(), accentHex: 'green' }, '#6EA8FF')).toBe('#6EA8FF');
    expect(accentFor(null, '#6EA8FF')).toBe('#6EA8FF');
  });
});
