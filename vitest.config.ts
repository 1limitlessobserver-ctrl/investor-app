import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    include: ['src/**/*.{spec,test}.{ts,tsx}', 'scripts/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '.reference/**'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
