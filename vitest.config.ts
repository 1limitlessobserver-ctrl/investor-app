import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** The package.json version, as vite.config.ts defines it for the app. */
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: {
      // vite-plugin-pwa makes this module for the build (vite.config.ts); specs get a stand-in.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegister.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    // Explicit rather than just the default: tests stub globals, so every file keeps its own worker.
    // It also stops Vitest suggesting `isolate: false` in the run summary.
    isolate: true,
    // Explicit for the same reason: with several DOM test files Vitest would otherwise suggest
    // `vmThreads` in the run summary. Plain forks (the default) keep every file in its own process.
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
    // Every spy is restored before each test, so a stub (a quiet console, say) never outlives its
    // test and hides what a later one prints.
    restoreMocks: true,
    include: ['src/**/*.{spec,test}.{ts,tsx}', 'scripts/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '.reference/**'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
