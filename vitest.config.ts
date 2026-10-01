import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{spec,test}.{ts,tsx}', 'scripts/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '.reference/**'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
