import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadCompanyConfig } from './scripts/company-config';
import { buildManifest } from './scripts/manifest';

/** The package.json version: X-App-Version on every request, and the update screen's check. */
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/**
 * The @fontsource subsets the app never shows (its copy is English): built, as the packages' CSS
 * names them, but left out of the precache, which keeps latin and latin-ext.
 */
const UNSHOWN_FONT_SUBSETS = [
  'cyrillic',
  'cyrillic-ext',
  'greek',
  'greek-ext',
  'vietnamese',
  'symbols',
];

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The installable app: the web manifest from company.config.json, and src/sw.ts built into
    // dist/sw.js with the precache list. UpdateToast registers the worker (no inline script), and
    // a new version waits for the investor's Reload. The dev server runs without a worker.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: buildManifest(loadCompanyConfig()),
      // The glob below finds the icons; the plugin lists the manifest itself. (Listed twice, each
      // would be precached under two entries.)
      includeManifestIcons: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        globIgnores: [
          ...UNSHOWN_FONT_SUBSETS.map((subset) => `**/*-${subset}-*.woff2`),
          // The manifest's screenshots are for the install dialog, fetched when it shows: not shell.
          'screenshots/**',
          'manifest.webmanifest',
        ],
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    // Fonts stay files: Vite inlines assets under 4 KiB as data: URLs (the JetBrains Mono
    // cyrillic-ext subset is 2 KiB), and the content security policy's font-src 'self' refuses them.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
});
