import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Fonts stay files: Vite inlines assets under 4 KiB as data: URLs (the JetBrains Mono
    // cyrillic-ext subset is 2 KiB), and the content security policy's font-src 'self' refuses them.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
});
