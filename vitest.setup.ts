import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';

// `globals: false` stops Testing Library registering its own cleanup, so unmount after each test.
afterEach(cleanup);
// Then every test starts on a fresh device, as each Playwright test gets a fresh browser context:
// what one test kept in web storage (a sample session, the lock choice, a cached brand) never
// reaches the next.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
// Vitest's jsdom environment already defines the `matchMedia` key (as undefined), so test the value,
// not the key. Writable and configurable, so a test can replace it by assignment or `vi.stubGlobal`.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
    writable: true,
    configurable: true,
  });
}
