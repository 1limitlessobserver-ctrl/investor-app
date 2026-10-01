import type { ManifestOptions } from 'vite-plugin-pwa';
import type { CompanyConfig } from './company-config';

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
    screenshots: [
      {
        src: '/screenshots/phone-home.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Home',
      },
      {
        src: '/screenshots/desktop-home.png',
        sizes: '1920x1080',
        type: 'image/png',
        form_factor: 'wide',
        label: 'Home',
      },
    ],
  };
}
