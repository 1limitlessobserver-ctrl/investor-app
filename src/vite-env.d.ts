/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** The package.json version, defined by vite.config.ts and vitest.config.ts. */
declare const __APP_VERSION__: string;

/** Written by scripts/apply-company.ts from company.config.json into .env.production. */
interface ImportMetaEnv {
  readonly VITE_PLATFORM_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
  readonly VITE_SHORT_NAME?: string;
  readonly VITE_ACCENT_FALLBACK?: string;
}
