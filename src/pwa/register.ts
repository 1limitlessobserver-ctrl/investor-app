// The service worker's registration, through vite-plugin-pwa's virtual module (the build makes it;
// vite.config.ts names src/sw.ts). This is the app's one import of that module, so the rest of
// the app has one place to read it from; specs mock `virtual:pwa-register/react` itself, and
// vitest.config.ts points it at a quiet stand-in (src/test/pwaRegister.ts) for the specs that
// render the app.

export { useRegisterSW } from 'virtual:pwa-register/react';
export type { RegisterSWOptions } from 'virtual:pwa-register/react';
