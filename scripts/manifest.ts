import type { ManifestOptions } from 'vite-plugin-pwa';
import type { CompanyConfig } from './company-config.ts';

/**
 * The manifest's screenshots, which let Chrome show its richer install dialog: Home in the sample
 * world on a phone and on a desktop, each a viewport in CSS pixels at a device scale. They are
 * taken by scripts/screenshots.ts into public/screenshots/, and their sizes follow from these.
 */
export const SCREENSHOTS = [
  { file: 'phone-home.png', width: 360, height: 640, scale: 3, formFactor: 'narrow' },
  { file: 'desktop-home.png', width: 1920, height: 1080, scale: 1, formFactor: 'wide' },
] as const;

export function buildManifest(config: CompanyConfig): Partial<ManifestOptions> {
  return {
    id: '/',
    name: config.productName,
    short_name: config.shortName,
    description: `${config.productName} — your portfolio, alerts, statements and money movement.`,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: config.accentFallback,
    background_color: config.backgroundColor,
    lang: 'en',
    categories: ['finance'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: SCREENSHOTS.map(({ file, width, height, scale, formFactor }) => ({
      src: `/screenshots/${file}`,
      sizes: `${width * scale}x${height * scale}`,
      type: 'image/png',
      form_factor: formFactor,
      label: 'Home',
    })),
  };
}
