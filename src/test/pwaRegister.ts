// What specs get for vite-plugin-pwa's `virtual:pwa-register/react`, which only the build makes
// (vitest.config.ts points the name here): no service worker is registered, no version waits and
// nothing reloads. A spec that needs a version waiting mocks `virtual:pwa-register/react` itself.

import type { useRegisterSW as useRegisterSWType } from 'virtual:pwa-register/react';

export const useRegisterSW: typeof useRegisterSWType = () => ({
  needRefresh: [false, () => {}],
  offlineReady: [false, () => {}],
  updateServiceWorker: () => Promise.resolve(),
});
