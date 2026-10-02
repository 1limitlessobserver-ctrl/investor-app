import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The package.json version: X-App-Version on every request, and the update screen's check. */
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    // Fonts stay files: Vite inlines assets under 4 KiB as data: URLs (the JetBrains Mono
    // cyrillic-ext subset is 2 KiB), and the content security policy's font-src 'self' refuses them.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
});
