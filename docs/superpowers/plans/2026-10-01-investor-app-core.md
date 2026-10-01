# Investor App Core (MOBILE-02, sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the white-label investor app as an installable web app (PWA) on clearly labelled sample data — design system, every screen, live client, device lock, push client, tests, CI, hosting and the repo bot — in the new public template repo `investor-app`.

**Architecture:** One static Vite + React 19 client with no backend of its own. Screens read through TanStack Query hooks → one `PlatformApi` interface with two implementations: `createSampleApi` (in-memory sample world, used now) and `createLiveApi` (HTTPS client for the platform's `/api/mobile/v1`, bearer tokens, single-flight refresh). `AppSession` picks the implementation from `company.config.json`, owns sign-in, tokens, lock, brand, theme and online state. Platform adapters (`src/platform/*`) isolate storage, lock, notifications, share, install and haptics so sub-project 2 can add desktop implementations. `scripts/apply-company` turns the one per-company file into manifest, icons, headers and env.

**Tech Stack:** Node 22, npm, Vite 7, React 19, TypeScript (strict), react-router v7 (data mode), @tanstack/react-query v5, vite-plugin-pwa (injectManifest, Workbox), radix-ui primitives, recharts, zod, react-hook-form, pdfmake, idb-keyval, @fontsource fonts, Vitest + Testing Library + jsdom + fake-indexeddb, Playwright (+ @axe-core/playwright), @lhci/cli 0.13 (Lighthouse 11), ESLint flat config + Prettier, GitHub Actions, Cloudflare Pages (Vercel config as alternative), anthropics/claude-code-action.

**Spec:** `docs/superpowers/specs/2026-10-01-investor-app-core-design.md` — executors read the spec and this plan. The platform's API contract is `.reference/platform/docs/MOBILE_API.md` (staged in Task 0).

## Global Constraints

Copied from the spec; every task's requirements include these.

- Free tiers only: GitHub public repo, Cloudflare Pages free, Vercel Hobby (previews only, non-commercial), the owner's Claude subscription for the repo bot. No paid service, no code signing.
- Platform sign-in only, through `/api/mobile/v1`; headers on every request `X-App-Version` (package.json version), `X-App-Platform: web`, `X-Device-Id` (random per install, 8–128 chars of `A–Z a–z 0–9 _ -`), optional `X-Device-Name` (percent-encoded UTF-8); `Authorization: Bearer <accessToken>` on signed-in routes; error envelope `{ error, message?, fields?, ...details }`; money is integer cents + currency code; figures with `basis: 'projection'` are shown as projections, never as market performance.
- Nothing company-specific outside `company.config.json`, `branding/icon.png` and generated files. Runtime identity (name, tagline, accent, logo, default theme, features, links, support) always from `GET /brand`.
- Sample mode when `platformUrl` is `""`: visible "Sample" ribbon on every screen; any email signs in; an email containing `+2fa` takes the two-factor step with code `123456`.
- No investor data persists beyond the session: query cache in memory; access token in memory; refresh token encrypted in IndexedDB; `localStorage` holds only `app.theme`, `app.lockEnabled` and the public brand; KYC draft and images in component state only.
- Every money action and account closure runs `useAppSession().confirm(reason)` first. Lock after 5 minutes hidden (unless `app.lockEnabled` is false), on launch with a stored session, and on "Lock now".
- Screens never call `fetch`; they use hooks from `src/queries`. Every API failure is a `MobileApiError`; screens show `message`, map `fields`, never raw codes. Offline: banner, money figures render "•••", mutations disabled.
- Themes: `orbital | obsidian | ivory | aurora | verdant | aegis`; any accent made readable (accent text ≥ 4.5:1 on background, card and surface; primary ≥ 3:1 on background; primary foreground pure `#000000` or `#FFFFFF`). WCAG AA everywhere, reduced motion honoured, 44 px targets, `rem` type sizes, labels on every control, keyboard navigation.
- Layout: phone tabs Home · Portfolio · Move (centre orb) · Legacy · Profile below 900 px; navigation rail + content column (max 720 px) + split panes at 900 px and above. Same routes and screens.
- Fonts self-hosted via `@fontsource` packages (Instrument Serif, Inter Tight, JetBrains Mono); no third-party scripts, fonts, analytics or CDNs. CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' <platformUrl>; frame-src <platformUrl>; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- Copy: plain, warm, short; no exclamation marks, no jargon, no promises about returns.
- Process: tests before code; one branch per task (`task/NN-name`), small conventional commits ending with the session trailer below; a pull request per task reviewed with `pr-review-toolkit:review-pr` and security-guidance before the owner merges; `superpowers:verification-before-completion` before any "done".

Commit trailer for every commit:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tq47Xy8cAPZuJ4rw41eFdA
```

## Review Focus

Inputs the spec implies but does not spell out, most likely to bite an investor first; each is pinned by a test in the owning task.

1. **Two screens resuming at once with an expired access token** — exactly one refresh, each request retried once, never a sign-out. Task 6 (`createLiveApi.spec.ts` "shares one refresh between concurrent requests" and "retries with the newer token when another request already refreshed").
2. **A company accent that is unreadable on a theme** (navy on Orbital, pale yellow on Ivory) — accent text and buttons are adjusted until readable. Task 3 (`themes.spec.ts` "makes any company accent readable").
3. **A $12,345,678.90 balance and a 40-character company name on a 320 px phone** — nothing overflows or is clipped. Task 17 (overflow audit with `stress` sample data on every route).
4. **Losing the network mid-session, then regaining it** — banner, balances hidden, mutations disabled, no stale numbers; everything returns on reconnect without a reload. Task 8 (`AppSession.spec.tsx` offline transitions) and Task 9 (e2e `offline.spec.ts`).
5. **The lock screen after the five-minute timer while a confirmation sheet is open, or after the refresh token was revoked on the website** — unlock never shows another investor's data and a revoked session lands on sign-in, not a blank screen. Task 8 (`AppSession.spec.tsx` "revoked while locked goes to sign-in").

## How this plan is executed

- Logic lives in test-driven modules whose specs are in this plan (Vitest). Screens and visual components are written directly against the contracts and acceptance checks in their task and verified by the component tests, Playwright tests and audits in this plan; the plan does not carry JSX for every screen.
- Reference material (Task 0) is staged under `.reference/` (gitignored, never committed): the earlier Floot build's locally authored files under `.reference/plan-b/` (port them — same stack) and platform sources under `.reference/platform/` (port for parity).
- Library APIs: before using a library for the first time in a task, confirm its current API with Context7 (when the connector is signed in) or the installed package's `README.md` and `.d.ts` files in `node_modules`; the code in this plan uses the APIs current as of October 2026 and names the import paths it relies on.
- Commands assume the repo root (`/home/claude/investor-app` in the build workspace).

## File structure

```
company.config.json              per-company identity (Task 2)
branding/icon.png                1024×1024 source icon; template ships a neutral one (Task 2)
index.html                       title/meta written by apply-company; <link rel="manifest">
vite.config.ts                   React, PWA (injectManifest), manifest from scripts/manifest.ts
vitest.config.ts, vitest.setup.ts
playwright.config.ts, lighthouserc.json, eslint.config.js, .prettierrc, tsconfig*.json
public/_headers (Cloudflare), vercel.json, public/icons/* (generated), public/screenshots/*
scripts/company-config.ts        zod schema + loader
scripts/manifest.ts              buildManifest(config) → web manifest object
scripts/apply-company.ts         writes index.html meta, _headers, vercel.json, .env.production
scripts/generate-icons.ts        sharp: 192, 512, 512 maskable, 180 apple, 96 badge
scripts/screenshots.ts           Playwright: manifest screenshots from the sample app
src/main.tsx                     providers + RouterProvider
src/app/router.tsx               routes (lazy screens), AppShell/FlowShell layouts
src/app/providers.tsx            QueryClientProvider, AppSessionProvider, Toaster
src/api/types.ts                 DTOs (mirror of MOBILE_API.md)
src/api/PlatformApi.ts           the interface
src/api/MobileApiError.ts
src/api/createLiveApi.ts         HTTP client
src/api/createSampleApi.ts       sample implementation (uses src/sample/*)
src/session/AppSession.tsx       provider + useAppSession
src/session/tokens.ts            token store over platform.storage
src/session/brand.ts             brand cache + apply
src/session/deviceId.ts
src/queries/*.ts                 one file per area: account, portfolio, money, legacy, support, alerts, oracle
src/design/contrast.ts, themes.ts, motion.ts, tokens.css, fonts.ts, useMotion.ts, useLayout.ts
src/components/*                 Panel, AppShell, FlowShell, NavRail, TabBar, HeaderActions,
                                 StatusBanners, UpdateRequired, LockScreen, ConfirmSheet, Starfield,
                                 SpaceBackdrop, BrandMark, StateView, CountUp, Amount, AmountField,
                                 OrbitalRing, ValueChart, ProgressRing, InstallButton, UpdateToast,
                                 form/* (Button, Input, Textarea, Switch, Select, Slider, Dialog, Sheet, Tabs, PinInput)
src/screens/*                    one folder per screen with Screen.tsx + Screen.module.css (+ .test.tsx)
src/platform/types.ts            adapter interfaces
src/platform/web/*.ts            storage, lock, notifications, share, install, haptics
src/platform/index.ts            picks web (desktop slot for sub-project 2)
src/sample/*                     sampleData, portfolioMath, sampleStatements, sampleOracle, kycGeo, fixtures
src/lib/*                        format, legacyPlanModel, statementPdf, imageCapture, alertTarget, version, semver
src/sw.ts                        service worker (precache, navigation fallback, push, notificationclick)
tests/e2e/*.spec.ts              Playwright
tests/audits/*.spec.ts           overflow, contrast, axe, motion
.github/workflows/ci.yml, claude.yml, claude-review.yml; .github/dependabot.yml
README.md, CLAUDE.md, CHANGELOG.md, LICENSE (MIT)
```

---

### Task 0: Workspace gate — network, references, GitHub remote

**Files:**
- Create: `.gitignore` (adds `.reference/`, `node_modules/`, `dist/`, `.env.local`, `playwright-report/`, `test-results/`, `.lighthouseci/`)
- Create (uncommitted): `.reference/plan-b/**`, `.reference/platform/**`

**Interfaces:**
- Produces: the staged reference tree used by Tasks 3, 5, 11, 14, 15; the GitHub remote `origin` used by every task's pull request.

- [ ] **Step 1: Network.** From the build workspace run `npm view vite version`. If it prints a version, continue. If it fails with `403 … Host not in allowlist: registry.npmjs.org`, stop and ask the owner to allow these hosts in the session's network egress settings (Claude desktop app → Settings → Cowork network access, or the organization's Admin settings → Capabilities): `registry.npmjs.org`, `api.github.com`, `github.com`, `objects.githubusercontent.com`, `playwright.download.prss.microsoft.com`, `cdn.playwright.dev`. Re-run the command after the change. No task proceeds until it prints a version.

- [ ] **Step 2: Stage the references from the owner's computer** (the platform folder is `C:\Users\ALIENWARE\Desktop\oo\marketos-platform`). With the device bridge connected, run on the device:

```bash
cd "$HOME/mnt/oo/marketos-platform"
mkdir -p "$HOME/mnt/oo/_claude_transfer/ref"
tar -czf "$HOME/mnt/oo/_claude_transfer/ref/platform-ref.tgz" \
  docs/MOBILE_API.md src/lib/mobile src/app/api/mobile src/lib/legacy-plan/model.ts \
  src/lib/kyc/geo.ts src/styles/summit-themes.css src/styles/aegis.css \
  $(grep -rlE "export (async )?function (positionView|allocationBySector|projectionSeries|nextSteps|computeEarnings|getUserAggregates|buildLiveKpis)\b" src/lib | sort -u)
```

(`src/lib/mobile` and `src/app/api/mobile` exist on the `mobile-01-plan-a` branch: if `master` is checked out, run `git show mobile-01-plan-a:docs/MOBILE_API.md > /tmp/MOBILE_API.md` and `git archive mobile-01-plan-a src/lib/mobile src/app/api/mobile | tar -x -C /tmp/plan-a` first and tar from there.) Then stage `platform-ref.tgz` and `marketos-platform/.superpowers/sdd/2026-10-01-mobile-app-plan-b/mobile-01-plan-b-backup-20261001T1023Z.tar.gz` into the workspace and extract:

```bash
mkdir -p .reference/plan-b .reference/platform
tar -xzf /mnt/user-data/uploads/oo/_claude_transfer/ref/platform-ref.tgz -C .reference/platform
tar -xzf "/mnt/user-data/uploads/oo/marketos-platform/.superpowers/sdd/2026-10-01-mobile-app-plan-b/mobile-01-plan-b-backup-20261001T1023Z.tar.gz" -C .reference/plan-b
ls .reference/plan-b/mobile/floot-app/pages | wc -l   # expect 48 files (pages + css + layouts)
ls .reference/platform/docs/MOBILE_API.md .reference/platform/src/lib/legacy-plan/model.ts
```

- [ ] **Step 3: GitHub remote.** With the GitHub connector signed in, create the public repository `investor-app` (description "White-label investor app — installable PWA and desktop client for the platform", MIT) and add it as `origin`; push `main` (the spec commit). If the connector is not signed in, ask the owner to create the empty public repo on github.com and paste its URL, then `git remote add origin <url> && git push -u origin main`. Enable branch protection on `main` (require a pull request and passing checks) once CI exists (Task 18).

- [ ] **Step 4: Commit the `.gitignore`.**

```bash
git checkout -b task/00-workspace
git add .gitignore
git commit -m "chore: ignore reference material, build output and local env"
git checkout main && git merge --ff-only task/00-workspace
```

### Task 1: Scaffold the Vite app with quality tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `.prettierrc`, `playwright.config.ts`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/app/App.test.tsx`, `src/vite-env.d.ts`, `LICENSE`, `README.md` (skeleton), `CLAUDE.md`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`, `test:watch`, `test:e2e`, `apply-company`, `icons`, `lhci`, `verify` (runs typecheck, lint, test, build in that order); `src/vite-env.d.ts` declares `virtual:pwa-register/react`.

- [ ] **Step 1: Scaffold and install.**

```bash
npm create vite@latest . -- --template react-ts   # answer "y" to scaffold in the non-empty folder; keep docs/ and .gitignore
npm install
npm install react-router @tanstack/react-query zod react-hook-form @hookform/resolvers radix-ui lucide-react sonner recharts pdfmake idb-keyval \
  @fontsource/instrument-serif @fontsource-variable/inter-tight @fontsource-variable/jetbrains-mono
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb \
  @playwright/test @axe-core/playwright @lhci/cli@0.13 vite-plugin-pwa workbox-precaching workbox-routing workbox-window \
  eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-jsx-a11y eslint-config-prettier prettier \
  sharp tsx @types/pdfmake @types/node
npx playwright install chromium   # WebKit is installed in CI (Task 18); install it here too if the download host is allowed
```

- [ ] **Step 2: `package.json` scripts** (replace the generated `scripts` block):

```json
{
  "scripts": {
    "dev": "vite",
    "build": "npm run apply-company && tsc -b && vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "apply-company": "tsx scripts/apply-company.ts",
    "icons": "tsx scripts/generate-icons.ts",
    "screenshots": "tsx scripts/screenshots.ts",
    "lhci": "lhci autorun",
    "audit:deps": "npm audit --audit-level=high",
    "verify": "npm run typecheck && npm run lint && npm run test && npm run build"
  }
}
```

- [ ] **Step 3: TypeScript strictness** — in `tsconfig.app.json` (generated by the template) set `"strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true, "exactOptionalPropertyTypes": true, "types": ["vite/client", "vite-plugin-pwa/react"]` and `"include": ["src", "scripts", "tests"]`. Add `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
```

- [ ] **Step 4: Vitest config** — `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{spec,test}.{ts,tsx}', 'scripts/**/*.spec.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

`vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false }),
  });
}
```

- [ ] **Step 5: ESLint flat config** — `eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.reference', 'playwright-report', 'test-results', 'dev-dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  reactHooks.configs['recommended-latest'],
  jsxA11y.flatConfigs.recommended,
  {
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Screens never fetch; use PlatformApi through src/queries.' }],
    },
  },
  { files: ['src/api/createLiveApi.ts', 'src/platform/**', 'scripts/**', 'tests/**'], rules: { 'no-restricted-globals': 'off' } },
  prettier,
);
```

`.prettierrc`: `{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`.

- [ ] **Step 6: Playwright config** — `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: 'phone-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'phone-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
```

- [ ] **Step 7: Write the failing smoke test** — `src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the shell placeholder', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Investor App' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to verify it fails.** Run: `npm test -- src/app/App.test.tsx`. Expected: FAIL — `./App` has no export `App`.

- [ ] **Step 9: Minimal `App`** — `src/app/App.tsx`:

```tsx
export function App() {
  return (
    <main>
      <h1>Investor App</h1>
    </main>
  );
}
```

`src/main.tsx` renders `<App />` inside `StrictMode`; delete the template's `App.css`, `index.css` and logo assets; `index.html` keeps `<div id="root">` and gets `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` and `<meta name="color-scheme" content="dark light">`.

- [ ] **Step 10: Run the whole gate.** Run: `npm run verify`. Expected: typecheck exit 0, lint 0 errors, 1 test passing, build exit 0 (`dist/index.html` exists).

- [ ] **Step 11: `CLAUDE.md`, `README.md`, `LICENSE`.** `CLAUDE.md` holds the rules an engineer or bot must follow (copy the Global Constraints of this plan in prose, the file layout, and the commands: `npm run verify`, `npm run test:e2e`, `npm run apply-company`); `README.md` starts with what the app is, sample vs live mode and the commands (expanded in Task 18); `LICENSE` is MIT with the owner's name.

- [ ] **Step 12: Commit and open the pull request.**

```bash
git checkout -b task/01-scaffold
git add -A && git commit -m "feat: scaffold Vite + React app with Vitest, Playwright, ESLint and project rules"
git push -u origin task/01-scaffold
```

Open a pull request "Task 1: scaffold" with the `npm run verify` output in its description; run `pr-review-toolkit:review-pr`; ask the owner to merge.

### Task 2: Company config, manifest, icons and apply-company

**Files:**
- Create: `company.config.json`, `branding/icon.png`, `scripts/company-config.ts`, `scripts/manifest.ts`, `scripts/apply-company.ts`, `scripts/generate-icons.ts`, `scripts/apply-company.spec.ts`, `public/_headers`, `vercel.json`
- Modify: `index.html` (placeholders), `vite.config.ts` (manifest from `buildManifest`)

**Interfaces:**
- Produces: `loadCompanyConfig(path = 'company.config.json'): CompanyConfig` where `CompanyConfig = { platformUrl: string; productName: string; shortName: string; identifier: string; icon: string; accentFallback: string; backgroundColor: string }`; `buildManifest(config: CompanyConfig): ManifestOptions` (vite-plugin-pwa's manifest type); `applyCompany(config, { root }): Promise<{ written: string[] }>`; `generateIcons(source: string, outDir: string): Promise<string[]>`; env `VITE_PLATFORM_URL`, `VITE_PRODUCT_NAME`, `VITE_SHORT_NAME`, `VITE_ACCENT_FALLBACK` read by Task 8's `appConfig`.

- [ ] **Step 1: Write the failing spec** — `scripts/apply-company.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { companyConfigSchema, loadCompanyConfig } from './company-config';
import { buildManifest } from './manifest';
import { applyCompany } from './apply-company';

const northwind = {
  platformUrl: 'https://invest.northwind.example',
  productName: 'Northwind Invest',
  shortName: 'Northwind',
  identifier: 'example.northwind.invest',
  icon: 'branding/icon.png',
  accentFallback: '#1F9E76',
  backgroundColor: '#05070F',
};

describe('company config', () => {
  it('accepts the template config and refuses a bad identifier', () => {
    expect(companyConfigSchema.safeParse(northwind).success).toBe(true);
    expect(companyConfigSchema.safeParse({ ...northwind, identifier: 'Not Valid!' }).success).toBe(false);
    expect(companyConfigSchema.safeParse({ ...northwind, platformUrl: 'http://insecure.example' }).success).toBe(false);
    expect(companyConfigSchema.safeParse({ ...northwind, platformUrl: 'https://a.example/' }).success).toBe(false);
    expect(companyConfigSchema.safeParse({ ...northwind, platformUrl: '' }).success).toBe(true);
  });

  it('builds a manifest from the config', () => {
    const m = buildManifest(northwind);
    expect(m.name).toBe('Northwind Invest');
    expect(m.short_name).toBe('Northwind');
    expect(m.id).toBe('/');
    expect(m.start_url).toBe('/?source=pwa');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#1F9E76');
    expect(m.background_color).toBe('#05070F');
    expect(m.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }),
        expect.objectContaining({ src: '/icons/icon-512-maskable.png', sizes: '512x512', purpose: 'maskable' }),
      ]),
    );
  });
});

describe('applyCompany', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'investor-app-'));
    await mkdir(path.join(root, 'branding'), { recursive: true });
    await mkdir(path.join(root, 'public'), { recursive: true });
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#1F9E76' } }).png().toFile(path.join(root, 'branding/icon.png'));
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><title>__PRODUCT_NAME__</title><meta name="application-name" content="__PRODUCT_NAME__"><meta name="theme-color" content="__ACCENT__"></head><body></body></html>');
    await writeFile(path.join(root, 'company.config.json'), JSON.stringify(northwind));
  });

  it('writes icons, headers, env and index.html for a fictitious company', async () => {
    const result = await applyCompany(loadCompanyConfig(path.join(root, 'company.config.json')), { root });
    for (const f of ['public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/icon-512-maskable.png', 'public/icons/apple-touch-icon.png', 'public/icons/badge-96.png', 'public/_headers', 'vercel.json', '.env.production']) {
      expect((await stat(path.join(root, f))).isFile(), f).toBe(true);
    }
    const meta = await sharp(path.join(root, 'public/icons/icon-512-maskable.png')).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
    expect(headers).toContain("connect-src 'self' https://invest.northwind.example");
    expect(headers).toContain('frame-ancestors');
    const env = await readFile(path.join(root, '.env.production'), 'utf8');
    expect(env).toContain('VITE_PLATFORM_URL=https://invest.northwind.example');
    expect(env).toContain('VITE_PRODUCT_NAME=Northwind Invest');
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('<title>Northwind Invest</title>');
    expect(html).toContain('content="#1F9E76"');
    expect(html).not.toContain('__PRODUCT_NAME__');
    expect(result.written.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps sample mode when platformUrl is empty', async () => {
    await writeFile(path.join(root, 'company.config.json'), JSON.stringify({ ...northwind, platformUrl: '' }));
    await applyCompany(loadCompanyConfig(path.join(root, 'company.config.json')), { root });
    const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
    expect(headers).toContain("connect-src 'self';");
    expect(await readFile(path.join(root, '.env.production'), 'utf8')).toContain('VITE_PLATFORM_URL=\n');
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npm test -- scripts/apply-company.spec.ts`. Expected: FAIL — modules `./company-config`, `./manifest`, `./apply-company` not found.

- [ ] **Step 3: Implement.** `scripts/company-config.ts`:

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const companyConfigSchema = z.object({
  platformUrl: z.union([z.literal(''), z.string().url().regex(/^https:\/\/[^/]+$/, 'HTTPS origin without a path or trailing slash')]),
  productName: z.string().min(1).max(60),
  shortName: z.string().min(1).max(12),
  identifier: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/, 'reverse-domain id like com.company.invest'),
  icon: z.string().min(1),
  accentFallback: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type CompanyConfig = z.infer<typeof companyConfigSchema>;

export function loadCompanyConfig(path = 'company.config.json'): CompanyConfig {
  const parsed = companyConfigSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`company.config.json is invalid:\n${issues}`);
  }
  return parsed.data;
}
```

`scripts/manifest.ts`:

```ts
import type { ManifestOptions } from 'vite-plugin-pwa';
import type { CompanyConfig } from './company-config';

export function buildManifest(config: CompanyConfig): Partial<ManifestOptions> {
  return {
    id: '/',
    name: config.productName,
    short_name: config.shortName,
    description: `${config.productName} — your portfolio, alerts, statements and money movement.`,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: config.accentFallback,
    background_color: config.backgroundColor,
    lang: 'en',
    categories: ['finance'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshots/phone-home.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'Home' },
      { src: '/screenshots/desktop-home.png', sizes: '1920x1080', type: 'image/png', form_factor: 'wide', label: 'Home' },
    ],
  };
}
```

`scripts/generate-icons.ts` (exports `generateIcons` and runs when executed directly):

```ts
import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const SIZES = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-512-maskable.png', size: 512, pad: 0.1 }, // safe zone: 10% padding each side
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'badge-96.png', size: 96, pad: 0 },
];

export async function generateIcons(source: string, outDir: string, background = '#05070F'): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const { file, size, pad } of SIZES) {
    const inner = Math.round(size * (1 - 2 * pad));
    const icon = await sharp(source).resize(inner, inner, { fit: 'contain', background }).png().toBuffer();
    const target = path.join(outDir, file);
    await sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: icon, gravity: 'centre' }])
      .png()
      .toFile(target);
    written.push(target);
  }
  return written;
}

if (process.argv[1] && process.argv[1].endsWith('generate-icons.ts')) {
  generateIcons(process.argv[2] ?? 'branding/icon.png', process.argv[3] ?? 'public/icons').then((w) => console.log(w.join('\n')));
}
```

`scripts/apply-company.ts`:

```ts
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadCompanyConfig, type CompanyConfig } from './company-config';
import { generateIcons } from './generate-icons';

export function securityHeaders(platformUrl: string): string[] {
  const connect = platformUrl ? `'self' ${platformUrl}` : "'self'";
  const frame = platformUrl ? platformUrl : "'none'";
  return [
    `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; frame-src ${frame}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Strict-Transport-Security: max-age=63072000; includeSubDomains',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: no-referrer',
    'Permissions-Policy: camera=(self), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(self)',
  ];
}

export async function applyCompany(config: CompanyConfig, { root = process.cwd() } = {}): Promise<{ written: string[] }> {
  const written: string[] = [];
  const p = (rel: string) => path.join(root, rel);

  written.push(...(await generateIcons(p(config.icon), p('public/icons'), config.backgroundColor)));

  const headers = securityHeaders(config.platformUrl);
  await writeFile(p('public/_headers'), ['/*', ...headers.map((h) => `  ${h}`), '', '/sw.js', '  Cache-Control: no-cache', '', '/manifest.webmanifest', '  Content-Type: application/manifest+json', ''].join('\n'));
  written.push(p('public/_headers'));

  await writeFile(
    p('vercel.json'),
    JSON.stringify({ headers: [{ source: '/(.*)', headers: headers.map((h) => { const [key, ...rest] = h.split(': '); return { key, value: rest.join(': ') }; }) }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] }, null, 2) + '\n',
  );
  written.push(p('vercel.json'));

  await writeFile(p('.env.production'), `VITE_PLATFORM_URL=${config.platformUrl}\nVITE_PRODUCT_NAME=${config.productName}\nVITE_SHORT_NAME=${config.shortName}\nVITE_ACCENT_FALLBACK=${config.accentFallback}\n`);
  written.push(p('.env.production'));

  const html = (await readFile(p('index.html'), 'utf8'))
    .replace(/<title>.*?<\/title>/, `<title>${config.productName}</title>`)
    .replace(/(<meta name="application-name" content=").*?(")/, `$1${config.productName}$2`)
    .replace(/(<meta name="theme-color" content=").*?(")/, `$1${config.accentFallback}$2`);
  await writeFile(p('index.html'), html);
  written.push(p('index.html'));
  return { written };
}

if (process.argv[1] && process.argv[1].endsWith('apply-company.ts')) {
  applyCompany(loadCompanyConfig()).then(({ written }) => console.log(`apply-company: ${written.length} files`)).catch((e) => { console.error(e.message); process.exit(1); });
}
```

Template `company.config.json`: `{ "platformUrl": "", "productName": "Investor App", "shortName": "Invest", "identifier": "app.investor.template", "icon": "branding/icon.png", "accentFallback": "#6EA8FF", "backgroundColor": "#05070F" }`. `branding/icon.png`: generate a neutral 1024×1024 orbit mark with sharp (an SVG of two concentric rings on `#05070F` with the accent `#6EA8FF`, rendered to PNG) — commit the PNG and the SVG source. `index.html` gets `<title>Investor App</title>`, `<meta name="application-name" content="Investor App">`, `<meta name="theme-color" content="#6EA8FF">`, `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="mobile-web-app-capable" content="yes">`. `.gitignore` adds `.env.production` (generated) — the committed `company.config.json` is the source. `vite.config.ts` reads the config and passes `buildManifest(config)` to the PWA plugin (configured in Task 9; until then `plugins: [react()]`).

- [ ] **Step 4: Run the spec.** Run: `npm test -- scripts/apply-company.spec.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Run the script for the template and the gate.** Run: `npm run apply-company && npm run verify`. Expected: `apply-company: 9 files`, gate green, `public/icons/` has five PNGs.

- [ ] **Step 6: Commit and open the pull request** (branch `task/02-company-config`, message `feat: company config, manifest, icons and apply-company script`), review, ask to merge.

### Task 3: Design system — contrast, themes, tokens, motion, fonts

**Files:**
- Create: `src/design/contrast.ts`, `src/design/contrast.spec.ts`, `src/design/themes.ts`, `src/design/themes.spec.ts`, `src/design/motion.ts`, `src/design/motion.spec.ts`, `src/design/useMotion.ts`, `src/design/useLayout.ts`, `src/design/tokens.css`, `src/design/fonts.ts`
- Reference: `.reference/platform/src/styles/summit-themes.css`, `.reference/platform/src/styles/aegis.css`

**Interfaces:**
- Produces: `contrast(hexA: string, hexB: string): number` (WCAG ratio ≥ 1); `relativeLuminance(hex): number`; `type ThemeId = 'orbital' | 'obsidian' | 'ivory' | 'aurora' | 'verdant' | 'aegis'`; `type ThemeTokens = { background; foreground; surface; card; cardForeground; popup; popupForeground; muted; mutedForeground; border; success; error; warning; info; signatureAccent: string; scheme: 'dark' | 'light'; display: 'serif' | 'grotesk'; radius: 'soft' | 'tight'; starfield: boolean }` (all colours `#rrggbb`); `type AccentTokens = { primary; primaryForeground; accentText; glow: string }`; `themes = { ids: readonly ThemeId[]; label(id): string; tokens(id): ThemeTokens; accent(accentHex: string, id: ThemeId): AccentTokens; apply(id: ThemeId, accentHex: string, root?: HTMLElement): void }`; `motion(prefersReducedMotion: boolean, hidden: boolean): { animate: boolean }`; `useMotion(): { animate: boolean }`; `useLayout(): 'phone' | 'wide'` (900 px breakpoint); `src/design/fonts.ts` imports the three `@fontsource` packages.

- [ ] **Step 1: Write the failing specs** — `src/design/contrast.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contrast } from './contrast';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
    expect(contrast('#05070F', '#ECF1FF')).toBeGreaterThan(17);
  });
  it('rejects malformed colours', () => {
    expect(() => contrast('red', '#fff')).toThrow();
  });
});
```

`src/design/themes.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { themes } from './themes';
import { contrast } from './contrast';

const REQUIRED = ['background', 'foreground', 'surface', 'card', 'cardForeground', 'popup', 'popupForeground', 'muted', 'mutedForeground', 'border', 'success', 'error', 'warning', 'info', 'signatureAccent'] as const;

describe('themes', () => {
  it('defines every token in all six themes', () => {
    expect(themes.ids).toEqual(['orbital', 'obsidian', 'ivory', 'aurora', 'verdant', 'aegis']);
    for (const id of themes.ids) {
      const t = themes.tokens(id) as unknown as Record<string, string>;
      for (const key of REQUIRED) expect(t[key], `${id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps body and muted text at WCAG AA on background, card and surface', () => {
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const surface of [t.background, t.card, t.surface]) {
        expect(contrast(t.foreground, surface), `${id} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.mutedForeground, surface), `${id} muted`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.popupForeground, t.popup), `${id} popup`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('makes any company accent readable as text and as a button', () => {
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const accent of ['#1F9E76', '#123456', '#E8F0A0', '#FF3B30', '#FFFFFF', '#000000', '#6EA8FF']) {
        const a = themes.accent(accent, id);
        for (const surface of [t.background, t.card, t.surface]) expect(contrast(a.accentText, surface), `${id} ${accent} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(a.primaryForeground, a.primary), `${id} ${accent} button text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(a.primary, t.background), `${id} ${accent} button on bg`).toBeGreaterThanOrEqual(3);
        expect(['#000000', '#FFFFFF']).toContain(a.primaryForeground.toUpperCase());
        expect(a.glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);
      }
    }
  });

  it('keeps an already readable accent unchanged', () => {
    expect(themes.accent('#7EE2B8', 'orbital').accentText.toUpperCase()).toBe('#7EE2B8');
  });

  it('applies a theme as CSS variables and attributes on the root', () => {
    const root = document.createElement('div');
    themes.apply('ivory', '#123456', root);
    expect(root.dataset.theme).toBe('ivory');
    expect(root.style.getPropertyValue('--background')).toBe(themes.tokens('ivory').background);
    expect(root.style.getPropertyValue('--primary')).toBe(themes.accent('#123456', 'ivory').primary);
    expect(root.style.getPropertyValue('color-scheme')).toBe('light');
    themes.apply('orbital', '#123456', root);
    expect(root.style.getPropertyValue('color-scheme')).toBe('dark');
  });
});
```

`src/design/motion.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { motion } from './motion';

describe('motion', () => {
  it('animates only with motion allowed and the app visible', () => {
    expect(motion(false, false).animate).toBe(true);
    expect(motion(true, false).animate).toBe(false);
    expect(motion(false, true).animate).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/design`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `contrast.ts`: parse `#rrggbb` (throw on anything else), sRGB → linear, `L = 0.2126R + 0.7152G + 0.0722B`, ratio `(Lmax + 0.05) / (Lmin + 0.05)`. Export `hexToRgb`, `rgbToHex`, `hexToHsl`, `hslToHex` for `themes.ts`.

`themes.ts` token sets — Orbital: `background #05070F, surface #0E1428, card #0B1020, cardForeground #ECF1FF, popup #121A33, popupForeground #ECF1FF, foreground #ECF1FF, muted #1A2340, mutedForeground #A9B4D0, border #25304D, success #7EE2B8, error #FF9C9C, warning #F2C879, info #8FB8FF, signatureAccent #6EA8FF, scheme dark, display serif, radius soft, starfield true`. Obsidian Sovereign, Ivory Estate, Quantum Aurora, Verdant Real Assets from `.reference/platform/src/styles/summit-themes.css` (`--s-bg → background`, `--s-panel → card`, `--s-tint → surface`, `--s-text → foreground`, `--s-muted → mutedForeground`, `--s-line → border`, `--s-good → success`, `--s-danger → error`, `--s-gold → signatureAccent`; `popup` = card; `muted` = surface; warning/info chosen per theme to pass 4.5:1 on background); AEGIS from `.reference/platform/src/styles/aegis.css` with `display: 'grotesk'`, `radius: 'tight'`; Aurora `starfield: true`. Where a website value misses 4.5:1 on background, card or surface, nudge its HSL lightness (one percent at a time, toward the foreground) until it passes and record the nudge in a comment.

`themes.accent(hex, id)`: `accentText` = the accent, lightness moved in 1 % steps toward the theme foreground's lightness (lighter on dark themes, darker on light themes) until ≥ 4.5:1 on background, card **and** surface — unchanged if already readable; `primary` = the accent moved the same way until ≥ 3:1 on the background; `primaryForeground` = `#000000` if `contrast('#000000', primary) >= contrast('#FFFFFF', primary)` else `#FFFFFF` (then, if the winner is below 4.5:1, keep moving `primary` toward the opposite lightness until it is); `glow` = `rgba(r, g, b, 0.45)` of `accentText`. `apply(id, accentHex, root = document.documentElement)` sets `data-theme`, `color-scheme` (`style.setProperty('color-scheme', scheme)`), and every token as `--kebab-case` plus `--primary`, `--primary-foreground`, `--accent-text`, `--glow`; also `document.querySelector('meta[name=theme-color]')?.setAttribute('content', primary)` when `root === document.documentElement`.

`tokens.css`: the `:root` defaults (Orbital), spacing scale (`--space-1: 0.25rem … --space-8: 2rem`), radii (`--radius-sm/md/lg/full`, `[data-theme='aegis']` tightens them), type (`--font-display`, `--font-ui`, `--font-mono`, sizes in `rem`, `font-variant-numeric: tabular-nums` on `.tabular`), glass (`--glass: color-mix(in srgb, var(--card) 72%, transparent)`, `--glass-border: color-mix(in srgb, var(--border) 70%, transparent)`), safe-area paddings, `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }`.

`motion.ts` as the spec; `useMotion()` combines `matchMedia('(prefers-reduced-motion: reduce)')`, `document.visibilityState` and a dev flag `localStorage['app.forceReducedMotion'] === '1'` (used by the audits); `useLayout()` from `matchMedia('(min-width: 900px)')`. `fonts.ts`: `import '@fontsource/instrument-serif'; import '@fontsource-variable/inter-tight'; import '@fontsource-variable/jetbrains-mono';`.

- [ ] **Step 4: Run the specs.** Run: `npm test -- src/design`. Expected: PASS (8 tests). Then `npm run verify` green.

- [ ] **Step 5: Commit and open the pull request** (`task/03-design-system`, `feat: theme engine with contrast maths, tokens, motion policy and self-hosted fonts`), review, ask to merge.

### Task 4: API contract — types, error, PlatformApi, formatting, version gate

**Files:**
- Create: `src/api/types.ts`, `src/api/PlatformApi.ts`, `src/api/MobileApiError.ts`, `src/api/MobileApiError.spec.ts`, `src/lib/format.ts`, `src/lib/format.spec.ts`, `src/lib/semver.ts`, `src/lib/semver.spec.ts`
- Reference: `.reference/platform/docs/MOBILE_API.md`, `.reference/platform/src/app/api/mobile/v1/**/route.ts`, `.reference/platform/src/lib/mobile/views.ts`, `.reference/plan-b/.superpowers/sdd/2026-10-01-mobile-app-plan-b/gen/mobileTypes.final.tsx`, `.../mobileErrors.draft.md`

**Interfaces:**
- Produces (`src/api/types.ts`, field names copied from the route handlers): `MobileTokens { tokenType: 'Bearer'; accessToken; refreshToken; accessExpiresAt; refreshExpiresAt }`, `LoginResult = ({ requiresTwoFactor: false } & MobileTokens) | { requiresTwoFactor: true; challenge: string }`, `Brand { name; tagline; accentHex; logoDataUrl: string | null; defaultTheme: ThemeId; themes: ThemeId[]; minSupportedAppVersion; features: { kyc; deposits; oracle; support: boolean }; stores: { appStore; googlePlay; androidDirect: string | null }; links: { website; privacy; terms; register; forgotPassword: string }; support: { email; phone: string | null }; vapidPublicKey?: string }`, `Me`, `KycStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'RESUBMIT'`, `NotificationCategory = 'deposit' | 'withdrawal' | 'referral' | 'support' | 'kyc' | 'security' | 'system'`, `AlertView { id; category; kind; title; body; amountCents: number | null; currency; entityType: string | null; entityId: string | null; read: boolean; createdAt }`, `Dashboard`, `PositionView`, `MaturityChoiceView`, `Investments`, `InvestmentDetail`, `Strategy`, `Strategies`, `HistoryEntry`, `History`, `StatementPeriod`, `StatementPeriods`, `StatementDetail { period: { key; label }; holder: { fullName; email }; openingCashCents; closingCashCents; lines: { date; description; direction: 'in' | 'out' | 'info'; amountCents }[]; positions: { plan; valueCents; basis: 'projection' }[]; currency }`, `TicketSummary`, `TicketThread`, `DepositMethod`, `DepositOverview { methods: DepositMethod[]; requests: DepositRequest[]; instant: 'live' | 'sandbox' | 'unavailable' }`, `Withdrawals { cashBalanceCents; requests; maturedPositions }`, `TransferView`, `Transfers`, `KycOverview`, `KycSubmission`, `LegacyPlan`, `LegacyProjection`, `LegacyPlanState { plan; revision; projection }`, `Beneficiary`, `BeneficiaryInput`, `Beneficiaries { beneficiaries; summary: { totalPercent; remainder } }`, `OracleAnswer`, `SessionView`, `PushSubscriptionInput { endpoint; keys: { p256dh; auth }; platform: 'web' }`.
- Produces (`src/api/PlatformApi.ts`): `interface PlatformApi { mode: 'sample' | 'live'; login(b: { email; password }): Promise<LoginResult>; loginTwoFactor(b: { challenge; code; useBackup? }): Promise<MobileTokens>; refresh(): Promise<MobileTokens>; logout(): Promise<void>; brand(): Promise<Brand>; me(): Promise<Me>; setNotificationPrefs(p: Record<NotificationCategory, boolean>): Promise<Me>; changePassword(b: { currentPassword; newPassword }): Promise<void>; setPin(b: { currentPassword; pin }): Promise<void>; sessions(): Promise<SessionView[]>; revokeSession(sessionId): Promise<{ ok: true; current: boolean }>; enrollTwoFactor(b: { currentPassword }): Promise<{ secret; uri; account }>; enableTwoFactor(b: { code }): Promise<{ backupCodes: string[] }>; disableTwoFactor(b: { currentPassword }): Promise<void>; closeAccount(b: { currentPassword }): Promise<void>; dashboard(): Promise<Dashboard>; investments(): Promise<Investments>; investment(id): Promise<InvestmentDetail>; strategies(): Promise<Strategies>; history(): Promise<History>; statements(kind: 'monthly' | 'quarterly'): Promise<StatementPeriods>; statement(period): Promise<StatementDetail>; statementCsv(period): Promise<string>; notifications(limit?): Promise<{ notifications: AlertView[]; unreadCount }>; markRead(id?: string): Promise<{ unreadCount }>; pushSubscribe(s: PushSubscriptionInput): Promise<void>; pushUnsubscribe(endpoint: string): Promise<void>; supportTickets(page?): Promise<{ tickets: TicketSummary[]; hasMore }>; openTicket(b: { subject; message }): Promise<TicketSummary>; ticket(id): Promise<TicketThread>; replyTicket(b: { id; message }): Promise<TicketThread>; depositMethods(): Promise<DepositOverview>; manualDeposit(b: { methodId; amountCents; reference? }): Promise<DepositRequest>; cardDeposit(b: { amountCents }): Promise<{ url }>; withdrawals(): Promise<Withdrawals>; requestWithdrawal(b: { kind: 'cash'; amountCents; destination? } | { kind: 'position'; investmentId }): Promise<WithdrawalRequest>; transfers(): Promise<Transfers>; sendTransfer(b: { recipient; amountCents; currency?; note?; pin }): Promise<TransferView>; invest(b: { planId; amountCents }): Promise<PositionView>; maturityChoice(b: { choiceId?; choice: 'REINVEST' | 'WITHDRAW'; planId? }): Promise<Investments>; kyc(): Promise<KycOverview>; submitKyc(s: KycSubmission): Promise<KycOverview>; legacyPlan(): Promise<LegacyPlanState>; saveLegacyPlan(b: { expectedRevision; plan }): Promise<LegacyPlanState>; previewLegacyPlan(plan): Promise<{ projection: LegacyProjection }>; beneficiaries(): Promise<Beneficiaries>; addBeneficiary(b: BeneficiaryInput): Promise<Beneficiaries>; updateBeneficiary(b: { id } & Partial<BeneficiaryInput>): Promise<Beneficiaries>; removeBeneficiary(id): Promise<Beneficiaries>; oracleAsk(b: { conversationId?; question }): Promise<OracleAnswer> }`.
- Produces: `class MobileApiError extends Error { code: string; status: number; fields: Record<string, string>; detail: string[]; retryAfterSeconds: number | null; constructor(code, status, message?, extra?: { fields?; detail?; retryAfterSeconds? }); static network(): MobileApiError (code 'network', status 0, 'You appear to be offline.'); static is(e: unknown): e is MobileApiError }`.
- Produces: `format = { money(cents: number, currency = 'USD'): string; moneyCompact(cents, currency = 'USD'): string; percent(value: number, opts?: { signed?: boolean; digits?: number }): string; date(iso: string, opts?: { timeZone?: string }): string; relative(iso: string, now?: Date): string }`; `compareSemver(a: string, b: string): -1 | 0 | 1`; `isBelowMinimum(current: string, minimum: string): boolean`.

- [ ] **Step 1: Write the failing specs** — `src/lib/format.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { format } from './format';

describe('format', () => {
  it('formats cents as currency', () => {
    expect(format.money(123456)).toBe('$1,234.56');
    expect(format.money(-5000)).toBe('-$50.00');
    expect(format.money(0)).toBe('$0.00');
    expect(format.money(250000, 'EUR')).toBe('€2,500.00');
  });
  it('compacts large amounts', () => {
    expect(format.moneyCompact(123456789)).toBe('$1.23M');
    expect(format.moneyCompact(99900)).toBe('$999');
    expect(format.moneyCompact(14182000)).toBe('$141.82K');
  });
  it('formats percentages', () => {
    expect(format.percent(12.345)).toBe('12.3%');
    expect(format.percent(1.2, { signed: true })).toBe('+1.2%');
    expect(format.percent(-0.5, { signed: true })).toBe('-0.5%');
    expect(format.percent(7, { digits: 0 })).toBe('7%');
  });
  it('formats dates in a fixed zone', () => {
    expect(format.date('2026-09-30T23:30:00.000Z', { timeZone: 'UTC' })).toBe('Sep 30, 2026');
  });
  it('says how long ago', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    expect(format.relative('2026-10-01T11:59:40.000Z', now)).toBe('just now');
    expect(format.relative('2026-10-01T11:55:00.000Z', now)).toBe('5m ago');
    expect(format.relative('2026-10-01T09:00:00.000Z', now)).toBe('3h ago');
    expect(format.relative('2026-09-30T10:00:00.000Z', now)).toBe('Yesterday');
    expect(format.relative('2026-09-20T10:00:00.000Z', now)).toBe('Sep 20');
  });
});
```

`src/lib/semver.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compareSemver, isBelowMinimum } from './semver';

describe('semver', () => {
  it('compares versions numerically', () => {
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });
  it('gates the app version', () => {
    expect(isBelowMinimum('1.2.0', '1.3.0')).toBe(true);
    expect(isBelowMinimum('1.3.0', '1.3.0')).toBe(false);
    expect(isBelowMinimum('garbage', '1.0.0')).toBe(false); // an unparsable value never locks the investor out
  });
});
```

`src/api/MobileApiError.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MobileApiError } from './MobileApiError';

describe('MobileApiError', () => {
  it('carries the envelope', () => {
    const e = new MobileApiError('invalid_input', 400, 'Check the highlighted fields.', { fields: { amountCents: 'Use whole cents.' } });
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.status, e.message, e.fields.amountCents, e.detail, e.retryAfterSeconds]).toEqual(['invalid_input', 400, 'Check the highlighted fields.', 'Use whole cents.', [], null]);
    expect(MobileApiError.is(e)).toBe(true);
    expect(MobileApiError.is(new Error('x'))).toBe(false);
  });
  it('has a calm default message per code', () => {
    expect(new MobileApiError('rate_limited', 429).message).toBe('Too many attempts. Please wait a moment and try again.');
    expect(MobileApiError.network().message).toBe('You appear to be offline.');
    expect(new MobileApiError('something_new', 418).message).toBe('Something went wrong. Please try again.');
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/lib src/api`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `format.ts` with `Intl.NumberFormat('en-US', { style: 'currency', currency })`, compact via `notation: 'compact', maximumFractionDigits: 2` (strip `.00`), `percent` with `maximumFractionDigits: digits ?? 1` and a `+` prefix when `signed` and positive, `date` with `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone })`, `relative`: < 60 s "just now", < 60 min `Nm ago`, < 24 h `Nh ago`, yesterday (calendar day, UTC) "Yesterday", else `Mon D` (same year) or `Mon D, YYYY`. `semver.ts`: split on `.`, parse ints, missing parts are 0, NaN → not below. `MobileApiError.ts` with a `DEFAULT_MESSAGES` map (`unauthorized`, `session_revoked` "This session has ended. Sign in again.", `rate_limited`, `server_error` "The platform had a problem. Your session is safe — try again.", `network`, `upgrade_required` "Please update the app to continue.", `feature_disabled` "This feature is not available right now.") and the generic fallback. `types.ts`: port `mobileTypes.final.tsx`, then diff every DTO against the staged route handlers and `views.ts` (field names and optionality must match; note each confirmed file in a comment at the top). `PlatformApi.ts`: the interface above.

- [ ] **Step 4: Run the specs.** Run: `npm test -- src/lib src/api`. Expected: PASS (11 tests). `npm run verify` green.

- [ ] **Step 5: Commit and open the pull request** (`task/04-api-contract`, `feat: API contract types, MobileApiError, formatting and version gate`), review, ask to merge.

### Task 5: Sample world — Legacy model, portfolio maths, fixtures, sample API, sample Oracle

**Files:**
- Create: `src/lib/legacyPlanModel.ts`, `src/lib/legacyPlanModel.spec.ts`, `src/sample/portfolioMath.ts`, `src/sample/portfolioMath.spec.ts`, `src/sample/__fixtures__/expected.json`, `src/sample/__fixtures__/qr.json`, `src/sample/sampleData.ts`, `src/sample/sampleStatements.ts`, `src/sample/sampleOracle.ts`, `src/sample/sampleOracle.spec.ts`, `src/sample/kycGeo.ts`, `src/api/createSampleApi.ts`, `src/api/createSampleApi.spec.ts`
- Reference: `.reference/platform/src/lib/legacy-plan/model.ts`, the portfolio function files staged in Task 0, `.reference/platform/src/lib/kyc/geo.ts`, `.reference/plan-b/.superpowers/sdd/2026-10-01-mobile-app-plan-b/gen/{sampleData.final.tsx,expected.json,qr.json,generate.ts}`, `.reference/plan-b/mobile/floot-app/helpers/{sampleOracle.tsx,sampleOracle.spec.tsx,kycGeo.tsx}`

**Interfaces:**
- Consumes: `types.ts`, `MobileApiError`, `format`.
- Produces: `legacyPlanModel = { defaultPlan: LegacyPlan; focuses: readonly { id; label; glyph }[]; project(plan: LegacyPlan): LegacyProjection }` (throws `Error('This scenario exceeds the supported range. Reduce the amount, rate or horizon.')`); `sampleData = { createState(opts?: { now?: Date; stress?: boolean }): SampleState }` where `SampleState` holds the investor, positions, strategies, alerts, tickets, transfers, deposit methods and requests, beneficiaries, legacy plan, sessions and `statement: StatementDetail`; `portfolioMath = { positionView, allocationBySector, projectionSeries, nextSteps, computeEarnings, getUserAggregates, buildLiveKpis }` with the platform's signatures; `createSampleApi({ latencyMs = 450, now = () => new Date(), stress = false, minSupportedAppVersion = '1.0.0' }): PlatformApi & { _test_revoke(): void }` (`_test_revoke` makes every later call except `brand`, `login` and `loginTwoFactor` reject with `session_revoked` 401; `minSupportedAppVersion` is what `brand()` reports); `sampleOracleAnswer(question, ctx: { brandName; dashboard; investments; now }, conversationId?): OracleAnswer`; `ORACLE_SUGGESTIONS: readonly string[]`; `kycGeo = { countries; priorityCountryCodes; usStates; documentTypes; employmentStatuses; sourcesOfFunds; purposes }`; sample credentials: any email, password anything, `+2fa` → code `123456`, sample password for sensitive actions `sample`.

- [ ] **Step 1: Write the failing specs** — `src/lib/legacyPlanModel.spec.ts` (expected values are the platform's own):

```ts
import { describe, it, expect } from 'vitest';
import { legacyPlanModel } from './legacyPlanModel';

describe('legacyPlanModel', () => {
  it('projects the default plan exactly as the platform does', () => {
    const p = legacyPlanModel.project(legacyPlanModel.defaultPlan);
    expect([p.endingCapitalCents, p.realCapitalCents, p.plannedContributionsCents]).toEqual([26500000, 16081424, 26500000]);
    expect([p.futureMonthlyIncomeGoalCents, p.targetCapitalCents, p.modelledMonthlyDrawCents, p.realMonthlyDrawCents]).toEqual([329573, 98871900, 88333, 53605]);
    expect(p.coveragePercent).toBe(26.8);
    expect(p.points.length).toBe(21);
    expect(p.points[1]).toEqual({ year: 1, nominalCents: 3700000, realCents: 3608741, contributionCents: 3700000 });
  });
  it('projects returns and fees exactly as the platform does', () => {
    const p = legacyPlanModel.project({ ...legacyPlanModel.defaultPlan, annualReturnBps: 600, annualFeeBps: 75, monthlyContributionCents: 150000, horizonYears: 25 });
    expect([p.endingCapitalCents, p.realCapitalCents, p.modelledGainsCents, p.modelledFeesCents]).toEqual([101999065, 54631672, 62284651, 7785586]);
    expect([p.targetCapitalCents, p.modelledMonthlyDrawCents, p.coveragePercent]).toEqual([112021800, 339997, 91]);
  });
  it('refuses a scenario outside the supported range', () => {
    expect(() => legacyPlanModel.project({ ...legacyPlanModel.defaultPlan, horizonYears: 50, startingCapitalCents: 100000000000, annualReturnBps: 3000 }))
      .toThrow('This scenario exceeds the supported range. Reduce the amount, rate or horizon.');
  });
});
```

`src/sample/portfolioMath.spec.ts` (parity with the platform's functions on the generated rows; `expected.json` is the output the platform's own functions produced for those rows, copied from the reference `gen/expected.json`):

```ts
import { describe, it, expect } from 'vitest';
import expected from './__fixtures__/expected.json';
import { sampleData } from './sampleData';
import { portfolioMath } from './portfolioMath';

const now = new Date(expected.generatedAt);

describe('portfolioMath parity', () => {
  const state = sampleData.createState({ now });
  it('values every position as the platform does', () => {
    for (const row of state.positions) {
      const view = portfolioMath.positionView(row, now);
      const want = expected.positions.find((p: { id: string }) => p.id === row.id);
      expect(view, row.id).toEqual(want);
    }
  });
  it('aggregates, allocates, projects and advises as the platform does', () => {
    expect(portfolioMath.getUserAggregates(state.positions, state.wallet, now)).toEqual(expected.aggregates);
    expect(portfolioMath.allocationBySector(state.positions, now)).toEqual(expected.allocation);
    expect(portfolioMath.projectionSeries(state.positions, now)).toEqual(expected.projection);
    expect(portfolioMath.buildLiveKpis(state.positions, state.wallet, now)).toEqual(expected.kpis);
    expect(portfolioMath.nextSteps(state.investor, state.positions, state.legacyPlan)).toEqual(expected.nextSteps);
  });
});
```

`src/api/createSampleApi.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSampleApi } from './createSampleApi';
import { MobileApiError } from './MobileApiError';

async function failure(p: Promise<unknown>): Promise<MobileApiError> {
  try { await p; } catch (e) { if (MobileApiError.is(e)) return e; throw e; }
  throw new Error('expected a MobileApiError');
}
const api = () => createSampleApi({ latencyMs: 0 });

describe('createSampleApi', () => {
  it('serves a brand and a dashboard in sample mode', async () => {
    const a = api();
    expect(a.mode).toBe('sample');
    const brand = await a.brand();
    expect(brand.name.length).toBeGreaterThan(0);
    expect(brand.themes).toContain('orbital');
    expect(brand.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const d = await a.dashboard();
    expect(d.totals.portfolioValueCents).toBeGreaterThan(0);
    expect(d.performance.basis).toBe('projection');
  });
  it('signs in with any email and asks for the second factor on +2fa', async () => {
    const a = api();
    const plain = await a.login({ email: 'anyone@example.com', password: 'x' });
    expect(plain.requiresTwoFactor).toBe(false);
    const step = await a.login({ email: 'investor+2fa@sample.app', password: 'anything' });
    expect(step.requiresTwoFactor).toBe(true);
    if (!step.requiresTwoFactor) return;
    expect((await failure(a.loginTwoFactor({ challenge: step.challenge, code: '000000' }))).code).toBe('invalid_code');
    expect((await a.loginTwoFactor({ challenge: step.challenge, code: '123456' })).tokenType).toBe('Bearer');
  });
  it('files a manual deposit as pending and lists it', async () => {
    const a = api();
    const methods = await a.depositMethods();
    const res = await a.manualDeposit({ methodId: methods.methods[0]!.id, amountCents: 50000, reference: 'tx-1' });
    expect(res.status).toBe('PENDING');
    expect((await a.depositMethods()).requests[0]).toEqual(expect.objectContaining({ id: res.id, amountCents: 50000, status: 'PENDING' }));
  });
  it('needs a PIN to send money and refuses a wrong one', async () => {
    const a = api();
    expect((await failure(a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '1234' }))).code).toBe('pin_required');
    await a.setPin({ currentPassword: 'sample', pin: '2468' });
    const wrong = await failure(a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '1111' }));
    expect([wrong.code, wrong.status]).toEqual(['invalid_pin', 403]);
    expect((await a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '2468' })).status).toBe('COMPLETED');
  });
  it('marks an alert read and lowers the unread count', async () => {
    const a = api();
    const before = await a.notifications();
    const unread = before.notifications.find((n) => !n.read)!;
    expect((await a.markRead(unread.id)).unreadCount).toBe(before.unreadCount - 1);
    expect((await a.markRead()).unreadCount).toBe(0);
  });
  it('keeps beneficiary shares within 100%', async () => {
    const a = api();
    const { summary } = await a.beneficiaries();
    const e = await failure(a.addBeneficiary({ fullName: 'Too Much', relationship: 'other', sharePercent: summary.remainder + 1 }));
    expect([e.code, e.status]).toEqual(['share_exceeds_100', 409]);
  });
  it('refuses a cash withdrawal above the cash balance', async () => {
    const a = api();
    const { cashBalanceCents } = await a.withdrawals();
    expect((await failure(a.requestWithdrawal({ kind: 'cash', amountCents: cashBalanceCents + 1 }))).code).toBe('insufficient_balance');
  });
  it('invests from the wallet and keeps the dashboard consistent', async () => {
    const a = api();
    const before = await a.dashboard();
    const { strategies } = await a.strategies();
    const open = strategies.find((s) => s.unlocked && s.capacity.remaining > 0)!;
    await a.invest({ planId: open.id, amountCents: open.minimumCents });
    const after = await a.dashboard();
    expect(after.cash.balanceCents).toBe(before.cash.balanceCents - open.minimumCents);
    expect((await a.investments()).positions.length).toBe((await api().investments()).positions.length + 1);
  });
  it('accepts a push subscription and an unsubscribe', async () => {
    const a = api();
    await expect(a.pushSubscribe({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' }, platform: 'web' })).resolves.toBeUndefined();
    await expect(a.pushUnsubscribe('https://push.example/abc')).resolves.toBeUndefined();
  });
  it('exposes a stress world for the overflow audit', async () => {
    const a = createSampleApi({ latencyMs: 0, stress: true });
    expect((await a.brand()).name.length).toBe(40);
    expect((await a.dashboard()).cash.balanceCents).toBe(1234567890);
  });
});
```

`src/sample/sampleOracle.spec.ts`: port `.reference/plan-b/mobile/floot-app/helpers/sampleOracle.spec.tsx` to Vitest unchanged in substance (suggested questions answered from the same dashboard/investments the screens show; unknown questions get the "sample mode" explanation; the platform's disclaimer text present on every answer).

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/sample src/lib/legacyPlanModel src/api/createSampleApi`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `legacyPlanModel.ts`: line-for-line port of `.reference/platform/src/lib/legacy-plan/model.ts` (BigInt maths, same rounding, same messages; the zod schema ported as is — the app ships zod). `portfolioMath.ts`: line-for-line port of the staged platform functions with the same names and argument order; `sampleData.ts`: port `gen/sampleData.final.tsx` (an **Elite**-tier investor "Alex Morgan", KYC approved; five positions — Energy, Aerospace, Treasury (completed), Real Estate, a matured Green Bond with a pending maturity choice; a pending manual deposit; eight alerts; two tickets; two transfers; six strategies with tier locks; monthly and quarterly periods and one statement; one beneficiary at 60 %; no saved legacy plan) with rows dated relative to `now`; `stress` swaps the brand name for a 40-character one and the wallet for `1234567890` cents. `__fixtures__/expected.json` and `qr.json` copied from the reference `gen/` (deposit QR codes encode non-functional `sample-…-preview-only` values; links use `example.com`). `sampleStatements.ts`: periods, statement detail, CSV export, history. `sampleOracle.ts` and `kycGeo.ts`: port from the reference helpers. `createSampleApi.ts`: one `state = sampleData.createState(...)` per instance; every method awaits `latencyMs`; validation with zod; errors as `MobileApiError` with the platform's codes and statuses (`invalid_credentials` 401, `invalid_code` 401, `pin_required` 409, `invalid_pin` 403, `share_exceeds_100` 409, `insufficient_balance` 409, `active_holdings` 409, `kyc_required` 403, `tier_required` 403, `feature_disabled` 403, `not_found` 404, `rate_limited` 429 for more than 30 Oracle questions per 10 minutes); `brand().vapidPublicKey` is a fixed 87-character base64url test key; `pushSubscribe` stores the subscription in state; sample password `sample` for `setPin`, `changePassword`, `closeAccount`, two-factor enrol/disable.

- [ ] **Step 4: Run the specs.** Run: `npm test -- src/sample src/lib/legacyPlanModel src/api/createSampleApi`. Expected: PASS (3 + 2 + 10 + the ported Oracle cases). `npm run verify` green.

- [ ] **Step 5: Commit and open the pull request** (`task/05-sample-world`, `feat: sample world with platform-parity maths, Legacy model and sample API`), review, ask to merge.

### Task 6: Live client

**Files:**
- Create: `src/api/createLiveApi.ts`, `src/api/createLiveApi.spec.ts`
- Reference: `.reference/platform/docs/MOBILE_API.md` (routes and error table)

**Interfaces:**
- Consumes: `PlatformApi`, `MobileApiError`, `types.ts`.
- Produces: `createLiveApi(config: { baseUrl: string; tokenStore: TokenStore; app: { version: string; platform: 'web'; deviceId: string; deviceName?: string }; fetchImpl?: typeof fetch; onSignedOut?: (reason: 'session_revoked' | 'refresh_failed') => void; onUpgradeRequired?: (minVersion: string) => void }): PlatformApi`; `type TokenStore = { get(): Promise<MobileTokens | null>; set(t: MobileTokens | null): Promise<void> }`; the route table (method, path, body) for every `PlatformApi` method as a `ROUTES` constant exported for the e2e route checks.

- [ ] **Step 1: Write the failing spec** — `src/api/createLiveApi.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLiveApi } from './createLiveApi';
import { MobileApiError } from './MobileApiError';
import type { MobileTokens } from './types';

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const pair = (n: number): MobileTokens => ({ tokenType: 'Bearer', accessToken: `a${n}`, refreshToken: `r${n}`, accessExpiresAt: '2026-10-01T12:15:00.000Z', refreshExpiresAt: '2026-10-31T12:00:00.000Z' });

function setup(script: (call: Call) => Response | Promise<Response>, initial: MobileTokens | null = pair(1)) {
  const calls: Call[] = [];
  let tokens = initial;
  const signedOut: string[] = [];
  const upgrades: string[] = [];
  const api = createLiveApi({
    baseUrl: 'https://platform.test/api/mobile/v1',
    tokenStore: { get: async () => tokens, set: async (t) => { tokens = t; } },
    app: { version: '1.2.0', platform: 'web', deviceId: 'device-0001', deviceName: 'Ada’s laptop' },
    fetchImpl: (async (url: string, init: RequestInit) => { const call = { url, init }; calls.push(call); return script(call); }) as unknown as typeof fetch,
    onSignedOut: (r) => signedOut.push(r),
    onUpgradeRequired: (v) => upgrades.push(v),
  });
  return { api, calls, signedOut, upgrades, tokens: () => tokens };
}
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
async function failure(p: Promise<unknown>): Promise<MobileApiError> {
  try { await p; } catch (e) { if (MobileApiError.is(e)) return e; throw e; }
  throw new Error('expected a MobileApiError');
}

describe('createLiveApi', () => {
  it('sends the bearer token and the app headers', async () => {
    const t = setup(() => json(200, { id: 'u1' }));
    await t.api.me();
    expect(t.calls[0]!.url).toBe('https://platform.test/api/mobile/v1/me');
    expect(header(t.calls[0]!, 'Authorization')).toBe('Bearer a1');
    expect([header(t.calls[0]!, 'X-App-Version'), header(t.calls[0]!, 'X-App-Platform'), header(t.calls[0]!, 'X-Device-Id')]).toEqual(['1.2.0', 'web', 'device-0001']);
    expect(header(t.calls[0]!, 'X-Device-Name')).toBe('Ada%E2%80%99s%20laptop');
    expect(t.calls[0]!.init.credentials).toBe('omit');
  });

  it('refreshes once and retries when the access token expired', async () => {
    const t = setup((c) => c.url.endsWith('/auth/refresh') ? json(200, pair(2)) : header(c, 'Authorization') === 'Bearer a1' ? json(401, { error: 'unauthorized' }) : json(200, { id: 'u1' }));
    expect((await t.api.me()).id).toBe('u1');
    expect(t.calls.map((c) => c.url.split('/v1')[1])).toEqual(['/me', '/auth/refresh', '/me']);
    expect(JSON.parse(String(t.calls[1]!.init.body))).toEqual({ refreshToken: 'r1' });
    expect(t.tokens()?.accessToken).toBe('a2');
  });

  it('shares one refresh between concurrent requests', async () => {
    const t = setup((c) => c.url.endsWith('/auth/refresh') ? json(200, pair(2)) : header(c, 'Authorization') === 'Bearer a1' ? json(401, { error: 'unauthorized' }) : json(200, { id: 'u1' }));
    await Promise.all([t.api.me(), t.api.dashboard(), t.api.notifications()]);
    expect(t.calls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBe(1);
    expect(t.signedOut).toEqual([]);
  });

  it('retries with the newer token when another request already refreshed', async () => {
    // a1 answers session_revoked (the platform replaced the session row after a refresh elsewhere) but by then the store holds a2
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const t = setup(async (c) => { if (header(c, 'Authorization') === 'Bearer a1') { await gate; return json(401, { error: 'session_revoked' }); } return json(200, { id: 'u1' }); });
    const first = t.api.me();
    await (t.api as unknown as { _test_setTokens: (p: MobileTokens) => Promise<void> })._test_setTokens(pair(2));
    release();
    expect((await first).id).toBe('u1');
    expect(t.signedOut).toEqual([]);
    expect(t.calls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBe(0);
  });

  it('signs out when the session was revoked', async () => {
    const t = setup(() => json(401, { error: 'session_revoked', message: 'This session has ended. Sign in again.' }));
    expect((await failure(t.api.me())).code).toBe('session_revoked');
    expect(t.signedOut).toEqual(['session_revoked']);
    expect(t.tokens()).toBeNull();
  });

  it('signs out when the refresh is refused but keeps the session on a 5xx refresh', async () => {
    const refused = setup((c) => c.url.endsWith('/auth/refresh') ? json(401, { error: 'session_revoked' }) : json(401, { error: 'unauthorized' }));
    expect((await failure(refused.api.me())).code).toBe('session_revoked');
    expect(refused.signedOut).toEqual(['refresh_failed']);
    expect(refused.tokens()).toBeNull();
    const flaky = setup((c) => c.url.endsWith('/auth/refresh') ? json(503, { error: 'server_error' }) : json(401, { error: 'unauthorized' }));
    expect((await failure(flaky.api.me())).code).toBe('server_error');
    expect(flaky.signedOut).toEqual([]);
    expect(flaky.tokens()?.refreshToken).toBe('r1');
  });

  it('reports an outdated app', async () => {
    const t = setup(() => json(426, { error: 'upgrade_required', minSupportedAppVersion: '1.3.0' }));
    expect((await failure(t.api.me())).code).toBe('upgrade_required');
    expect(t.upgrades).toEqual(['1.3.0']);
  });

  it('maps the error envelope with field messages and Retry-After', async () => {
    const t = setup(() => json(400, { error: 'invalid_input', message: 'Check the highlighted fields.', fields: { amountCents: 'Use whole cents.' } }));
    const e = await failure(t.api.manualDeposit({ methodId: 'm1', amountCents: 12 }));
    expect([e.code, e.status, e.message, e.fields.amountCents]).toEqual(['invalid_input', 400, 'Check the highlighted fields.', 'Use whole cents.']);
    const limited = setup(() => json(429, { error: 'rate_limited' }, { 'Retry-After': '30' }));
    expect((await failure(limited.api.me())).retryAfterSeconds).toBe(30);
  });

  it('reports a network failure as offline', async () => {
    const t = setup(() => { throw new TypeError('Failed to fetch'); });
    const e = await failure(t.api.me());
    expect([e.code, e.status]).toEqual(['network', 0]);
  });

  it('logs out with the refresh token and always clears tokens', async () => {
    const t = setup(() => json(500, { error: 'server_error' }));
    await t.api.logout();
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ refreshToken: 'r1' });
    expect(t.tokens()).toBeNull();
  });

  it('reads the statement CSV as text and sends a push subscription', async () => {
    const t = setup((c) => c.url.includes('/statements/file') ? new Response('date,description\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }) : json(200, { ok: true }));
    expect(await t.api.statementCsv('2026-09')).toBe('date,description\n');
    expect(t.calls[0]!.url).toBe('https://platform.test/api/mobile/v1/statements/file?period=2026-09');
    await t.api.pushSubscribe({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' }, platform: 'web' });
    expect(t.calls[1]!.url.endsWith('/push/subscribe')).toBe(true);
    expect(t.calls[1]!.init.method).toBe('POST');
  });

  it('calls brand without a token', async () => {
    const t = setup(() => json(200, { name: 'Northwind' }), null);
    expect((await t.api.brand()).name).toBe('Northwind');
    expect(header(t.calls[0]!, 'Authorization')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npm test -- src/api/createLiveApi`. Expected: FAIL — module missing.

- [ ] **Step 3: Implement `createLiveApi.ts`.** One private `request<T>(route, { body?, query?, auth = true, text = false })`: JSON body, `credentials: 'omit'`, the app headers (`X-Device-Name` via `encodeURIComponent`), `Authorization` when `auth` and a token exists; non-2xx → parse the envelope (tolerate a non-JSON body) → `401 unauthorized` → `refreshOnce()` then one retry with the newly stored token; `401 session_revoked` → if the store now holds a different access token than the one sent, retry once with it (another request refreshed), else clear tokens, `onSignedOut('session_revoked')`, throw; `426` → `onUpgradeRequired(body.minSupportedAppVersion)` and throw; `429` → `retryAfterSeconds` from the header; other → `MobileApiError(error, status, message, { fields, detail })`; a thrown fetch → `MobileApiError.network()`. `refreshOnce()`: a shared in-flight promise posting `/auth/refresh` with the stored refresh token (`auth: false`); on 2xx store the pair; on 4xx clear tokens and `onSignedOut('refresh_failed')` then throw the envelope error; on 5xx/429/network rethrow without clearing. `logout()`: POST `/auth/logout` with `{ refreshToken }` and the bearer, ignore any failure, always `tokenStore.set(null)`. `refresh()`: public, same single flight. `statementCsv` uses `text: true`. Expose `_test_setTokens` only when `import.meta.env.MODE === 'test'` (it writes to the token store). `ROUTES`: every method's `{ method: 'GET' | 'POST', path }` — copy paths from `MOBILE_API.md` (`/me/notification-prefs`, `/me/password`, `/me/pin`, `/me/sessions`, `/me/sessions/revoke`, `/me/two-factor/enroll|enable|disable`, `/me/close`, `/dashboard`, `/investments`, `/investments/detail?id=`, `/strategies`, `/history`, `/statements?kind=`, `/statements/detail?period=`, `/statements/file?period=`, `/notifications?limit=`, `/notifications/read`, `/push/subscribe`, `/push/unsubscribe`, `/support/tickets?page=`, `/support/tickets`, `/support/ticket?id=`, `/support/reply`, `/deposit/methods`, `/deposit/manual`, `/deposit/checkout`, `/withdrawals`, `/transfers`, `/invest`, `/maturity-choice`, `/kyc`, `/legacy-plan`, `/legacy-plan/preview`, `/beneficiaries`, `/beneficiaries/update`, `/beneficiaries/remove`, `/oracle/ask`, `/auth/login`, `/auth/login/2fa`, `/auth/refresh`, `/auth/logout`, `/brand`).

- [ ] **Step 4: Run the spec.** Run: `npm test -- src/api/createLiveApi`. Expected: PASS (12 tests). `npm run verify` green.

- [ ] **Step 5: Commit and open the pull request** (`task/06-live-client`, `feat: live platform client with single-flight refresh and error mapping`), review, ask to merge.

### Task 7: Platform adapters (web) — secure storage, device lock, notifications, share, install, haptics

**Files:**
- Create: `src/platform/types.ts`, `src/platform/index.ts`, `src/platform/web/storage.ts`, `src/platform/web/storage.spec.ts`, `src/platform/web/lock.ts`, `src/platform/web/lock.spec.ts`, `src/platform/web/notifications.ts`, `src/platform/web/notifications.spec.ts`, `src/platform/web/share.ts`, `src/platform/web/share.spec.ts`, `src/platform/web/install.ts`, `src/platform/web/install.spec.ts`, `src/platform/web/haptics.ts`, `src/lib/base64url.ts`

**Interfaces:**
- Produces (`src/platform/types.ts`):
  - `SecureStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; clear(): Promise<void> }`
  - `LockMethod = 'webauthn' | 'passcode'`; `LockAdapter { available(): Promise<LockMethod>; enrolled(): Promise<LockMethod | null>; enrollWebAuthn(user: { id: string; email: string }): Promise<void>; enrollPasscode(code: string): Promise<void>; verify(): Promise<boolean>; verifyPasscode(code: string): Promise<{ ok: boolean; attemptsLeft: number }>; clear(): Promise<void> }`
  - `NotificationsAdapter { permission(): 'default' | 'granted' | 'denied' | 'unsupported'; request(): Promise<'granted' | 'denied' | 'unsupported'>; subscribe(vapidPublicKey: string): Promise<PushSubscriptionInput>; unsubscribe(): Promise<string | null>; show(n: { title: string; body?: string; tag?: string }): Promise<void> }`
  - `ShareAdapter { files(files: File[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'> }`
  - `InstallAdapter { canPrompt(): boolean; prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>; isInstalled(): boolean; hint(): 'safari-ios' | 'safari-mac' | null; subscribe(listener: () => void): () => void }`
  - `HapticsAdapter { tick(): void; success(): void; warn(): void }`
  - `Platform { kind: 'web' | 'desktop'; storage; lock; notifications; share; install; haptics }`
- Produces: `createSecureStorage(opts?: { db?: KvStore; keyStore?: KvStore }): SecureStorage` where `KvStore = { get(k): Promise<unknown>; set(k, v): Promise<void>; del(k): Promise<void>; keys(): Promise<string[]> }` (default: idb-keyval over database `investor-app`, store `secure`); `createLock(opts: { storage: SecureStorage; rpId?: string; origin?: string; credentials?: CredentialsContainer }): LockAdapter`; `verifyAssertion(input: { publicKeySpki: Uint8Array; alg: -7 | -257; authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array; expectedChallenge: Uint8Array; expectedOrigin: string; rpId: string }): Promise<boolean>`; `createWebNotifications(opts?: { registration?: () => Promise<ServiceWorkerRegistration> }): NotificationsAdapter`; `createWebShare(): ShareAdapter`; `createWebInstall(opts?: { userAgent?: string; platform?: string; matchMedia?: typeof window.matchMedia }): InstallAdapter`; `webHaptics: HapticsAdapter`; `platform: Platform` from `src/platform/index.ts` (`kind: 'web'`; sub-project 2 adds `desktop`); `base64url = { encode(bytes: Uint8Array): string; decode(s: string): Uint8Array }`.

- [ ] **Step 1: Write the failing specs.** `src/platform/web/storage.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSecureStorage, type KvStore } from './storage';

function memoryStore(): KvStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return { raw, get: async (k) => raw.get(k), set: async (k, v) => { raw.set(k, v); }, del: async (k) => { raw.delete(k); }, keys: async () => [...raw.keys()] };
}

describe('secure storage', () => {
  it('round-trips a value and never stores it in plain text', async () => {
    const db = memoryStore();
    const storage = createSecureStorage({ db });
    await storage.set('refreshToken', 'r-secret-123');
    expect(await storage.get('refreshToken')).toBe('r-secret-123');
    for (const v of db.raw.values()) expect(JSON.stringify(v, (_k, x) => (x instanceof Uint8Array || ArrayBuffer.isView(x)) ? Array.from(x as Uint8Array) : x)).not.toContain('r-secret-123');
    await storage.remove('refreshToken');
    expect(await storage.get('refreshToken')).toBeNull();
  });
  it('keeps the key non-extractable and survives a second instance over the same store', async () => {
    const db = memoryStore();
    await createSecureStorage({ db }).set('a', '1');
    const key = db.raw.get('secure:key') as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(await createSecureStorage({ db }).get('a')).toBe('1');
  });
  it('clear removes every secure entry', async () => {
    const db = memoryStore();
    const storage = createSecureStorage({ db });
    await storage.set('a', '1'); await storage.set('b', '2'); await storage.clear();
    expect([await storage.get('a'), await storage.get('b')]).toEqual([null, null]);
  });
});
```

`src/platform/web/lock.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createLock, verifyAssertion } from './lock';
import { createSecureStorage, type KvStore } from './storage';
import { base64url } from '../../lib/base64url';

function memoryStore(): KvStore { const raw = new Map<string, unknown>(); return { get: async (k) => raw.get(k), set: async (k, v) => { raw.set(k, v); }, del: async (k) => { raw.delete(k); }, keys: async () => [...raw.keys()] }; }
const storage = () => createSecureStorage({ db: memoryStore() });

function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0]! & 0x80) v = new Uint8Array([0, ...v]); return new Uint8Array([0x02, v.length, ...v]); };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

async function fabricate(opts: { alg: -7 | -257; challenge: Uint8Array; origin: string; rpId: string; uv: boolean }) {
  const keyPair = opts.alg === -7
    ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    : await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.rpId)));
  const authenticatorData = new Uint8Array(37); authenticatorData.set(rpIdHash); authenticatorData[32] = opts.uv ? 0x05 : 0x01;
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: base64url.encode(opts.challenge), origin: opts.origin }));
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = new Uint8Array([...authenticatorData, ...clientHash]);
  let signature = new Uint8Array(await crypto.subtle.sign(opts.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }, keyPair.privateKey, signed));
  if (opts.alg === -7) signature = rawToDer(signature);
  return { publicKeySpki, alg: opts.alg, authenticatorData, clientDataJSON, signature };
}

describe('verifyAssertion', () => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  it('accepts a valid ES256 and RS256 assertion', async () => {
    for (const alg of [-7, -257] as const) {
      const a = await fabricate({ alg, challenge, origin: 'https://app.example', rpId: 'app.example', uv: true });
      expect(await verifyAssertion({ ...a, expectedChallenge: challenge, expectedOrigin: 'https://app.example', rpId: 'app.example' }), String(alg)).toBe(true);
    }
  });
  it('rejects a wrong challenge, origin, rpId, missing user verification or a bad signature', async () => {
    const a = await fabricate({ alg: -7, challenge, origin: 'https://app.example', rpId: 'app.example', uv: true });
    const ok = { ...a, expectedChallenge: challenge, expectedOrigin: 'https://app.example', rpId: 'app.example' };
    expect(await verifyAssertion({ ...ok, expectedChallenge: crypto.getRandomValues(new Uint8Array(32)) })).toBe(false);
    expect(await verifyAssertion({ ...ok, expectedOrigin: 'https://evil.example' })).toBe(false);
    expect(await verifyAssertion({ ...ok, rpId: 'other.example' })).toBe(false);
    const noUv = await fabricate({ alg: -7, challenge, origin: 'https://app.example', rpId: 'app.example', uv: false });
    expect(await verifyAssertion({ ...noUv, expectedChallenge: challenge, expectedOrigin: 'https://app.example', rpId: 'app.example' })).toBe(false);
    const tampered = new Uint8Array(a.signature); tampered[tampered.length - 1] ^= 0xff;
    expect(await verifyAssertion({ ...ok, signature: tampered })).toBe(false);
  });
});

describe('passcode lock', () => {
  it('enrols, verifies, counts attempts and clears after five failures', async () => {
    const lock = createLock({ storage: storage(), credentials: undefined });
    expect(await lock.available()).toBe('passcode');
    expect(await lock.enrolled()).toBeNull();
    await lock.enrollPasscode('246810');
    expect(await lock.enrolled()).toBe('passcode');
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: true, attemptsLeft: 5 });
    for (let i = 4; i >= 1; i--) expect(await lock.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: i });
    expect(await lock.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: 0 });
    expect(await lock.enrolled()).toBeNull(); // wiped after the fifth failure
  });
  it('refuses a passcode that is not six digits', async () => {
    const lock = createLock({ storage: storage(), credentials: undefined });
    await expect(lock.enrollPasscode('12')).rejects.toThrow('six digits');
  });
});

describe('webauthn lock', () => {
  it('reports webauthn when a platform authenticator exists and verifies through credentials.get', async () => {
    const challengeSeen: Uint8Array[] = [];
    const assertion = await fabricate({ alg: -7, challenge: new Uint8Array(32), origin: 'http://localhost:3000', rpId: 'localhost', uv: true });
    const credentials = {
      create: vi.fn(async () => ({ rawId: new Uint8Array([1, 2, 3]).buffer, response: { getPublicKey: () => assertion.publicKeySpki.buffer, getPublicKeyAlgorithm: () => -7 } })),
      get: vi.fn(async (o: { publicKey: { challenge: Uint8Array } }) => { challengeSeen.push(o.publicKey.challenge); return null; }),
    } as unknown as CredentialsContainer;
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
    const lock = createLock({ storage: storage(), credentials, rpId: 'localhost', origin: 'http://localhost:3000' });
    expect(await lock.available()).toBe('webauthn');
    await lock.enrollWebAuthn({ id: 'u1', email: 'ada@example.com' });
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await lock.verify()).toBe(false); // the stub returned no assertion
    expect(challengeSeen[0]!.length).toBe(32);
    const createArg = (credentials.create as unknown as { mock: { calls: [[{ publicKey: { authenticatorSelection: unknown; user: { name: string; id: Uint8Array } } }]] } }).mock.calls[0][0].publicKey;
    expect(createArg.authenticatorSelection).toEqual({ authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' });
    expect(createArg.user.name).toBe('ada@example.com');
    expect(createArg.user.id.length).toBe(32); // a random handle, never the email
  });
});
```

`src/platform/web/notifications.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWebNotifications } from './notifications';

describe('web notifications', () => {
  it('subscribes with the VAPID key and returns the platform payload', async () => {
    const sub = { endpoint: 'https://push.example/abc', toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: vi.fn(async () => true) };
    const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => sub) };
    (globalThis as { Notification?: unknown }).Notification = { permission: 'granted', requestPermission: async () => 'granted' };
    const n = createWebNotifications({ registration: async () => ({ pushManager, showNotification: vi.fn() }) as unknown as ServiceWorkerRegistration });
    const key = 'BPhdfj-y8kOzT3Sd9yXMbWcQ4T1jg0tQmxNCDsB6cYbm3wLsgT4eUKL6vK9Qh0z7u6MkW6iSsO5l1YV7Jq6fCnM';
    const out = await n.subscribe(key);
    expect(out).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' }, platform: 'web' });
    const arg = pushManager.subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(arg.userVisibleOnly).toBe(true);
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(arg.applicationServerKey.length).toBe(65);
    expect(await n.unsubscribe()).toBe('https://push.example/abc');
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
  it('reports unsupported without a service worker or Notification API', () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(createWebNotifications({ registration: undefined }).permission()).toBe('unsupported');
  });
});
```

`src/platform/web/install.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWebInstall } from './install';

const mm = (standalone: boolean) => ((q: string) => ({ matches: q.includes('standalone') && standalone, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

describe('install adapter', () => {
  it('offers the prompt only after beforeinstallprompt and reports the choice', async () => {
    const install = createWebInstall({ userAgent: 'Chrome/130', platform: 'Win32', matchMedia: mm(false) });
    expect(install.canPrompt()).toBe(false);
    const listener = vi.fn(); install.subscribe(listener);
    const ev = Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(ev);
    expect(install.canPrompt()).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(await install.prompt()).toBe('accepted');
    expect(install.canPrompt()).toBe(false); // a prompt event is single use
  });
  it('knows when it is installed and which Safari hint applies', () => {
    expect(createWebInstall({ userAgent: 'Chrome/130', platform: 'Win32', matchMedia: mm(true) }).isInstalled()).toBe(true);
    expect(createWebInstall({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', matchMedia: mm(false) }).hint()).toBe('safari-ios');
    expect(createWebInstall({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', platform: 'MacIntel', matchMedia: mm(false) }).hint()).toBe('safari-mac');
    expect(createWebInstall({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', platform: 'MacIntel', matchMedia: mm(false) }).hint()).toBeNull();
    expect(createWebInstall({ userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Safari/604.1', platform: 'iPhone', matchMedia: mm(true) }).hint()).toBeNull(); // already installed
  });
});
```

`src/platform/web/share.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWebShare } from './share';

describe('web share', () => {
  const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
  it('uses the share sheet when files can be shared', async () => {
    Object.assign(navigator, { canShare: () => true, share: vi.fn(async () => {}) });
    expect(await createWebShare().files([file], 'Statement')).toBe('shared');
    expect((navigator.share as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toEqual({ files: [file], title: 'Statement' });
  });
  it('reports a cancelled share', async () => {
    Object.assign(navigator, { canShare: () => true, share: vi.fn(async () => { throw new DOMException('cancel', 'AbortError'); }) });
    expect(await createWebShare().files([file], 'Statement')).toBe('cancelled');
  });
  it('downloads when sharing files is unsupported', async () => {
    Object.assign(navigator, { canShare: undefined, share: undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    expect(await createWebShare().files([file], 'Statement')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/platform`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `base64url.ts` (encode/decode without padding). `storage.ts`: `createSecureStorage` keeps one AES-GCM 256 key under `secure:key` in `keyStore` (`crypto.subtle.generateKey(..., false, ['encrypt', 'decrypt'])`, non-extractable; generated once, read on every instance); values stored under `secure:<key>` as `{ iv: Uint8Array(12), data: Uint8Array }`; `get` decrypts (returns `null` when absent or when decryption fails after a key loss, which also removes the stale entry); `clear` deletes every `secure:` key except the key itself; default stores from `idb-keyval` (`createStore('investor-app', 'secure')`). `lock.ts`: `available()` → `'webauthn'` when `credentials` (default `navigator.credentials`) exists and `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves true, else `'passcode'`; `enrollWebAuthn` calls `credentials.create` with `rp: { id: rpId, name: document.title }`, `user: { id: random 32 bytes, name: email, displayName: email }`, `pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }]`, `authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }`, `challenge: random 32 bytes`, `timeout: 60000`, stores `{ credentialId, publicKeySpki, alg }` base64url-encoded under `lock:webauthn`; `verify()` builds a random challenge, calls `credentials.get({ publicKey: { challenge, allowCredentials: [{ id, type: 'public-key' }], userVerification: 'required', rpId, timeout: 60000 } })`, returns `false` on `null`/throw, else `verifyAssertion(...)`; `verifyAssertion` checks `clientDataJSON.type === 'webauthn.get'`, `challenge` (base64url equal), `origin`, `rpIdHash === SHA-256(rpId)`, flags UP (0x01) and UV (0x04) set, then verifies the signature over `authenticatorData || SHA-256(clientDataJSON)` with `crypto.subtle.verify` (`ECDSA` with the DER signature converted to raw r||s; `RSASSA-PKCS1-v1_5` as is); `enrollPasscode` requires `/^\d{6}$/` (throw `Error('The passcode must be six digits.')`), stores `{ salt, hash, attempts: 0 }` with PBKDF2-SHA256 310 000 iterations (`crypto.subtle.deriveBits`); `verifyPasscode` compares constant-time, resets attempts on success, increments on failure, wipes the entry when attempts reach 5 (`attemptsLeft: 0`); `enrolled()` reads which entry exists; `clear()` removes both. `notifications.ts`: `permission()` from `Notification.permission` or `'unsupported'`; `subscribe` → `registration().pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64url.decode(vapidPublicKey) })` (reuse an existing subscription) and map `toJSON()` to `PushSubscriptionInput`; `unsubscribe` → existing subscription's `unsubscribe()` and return its endpoint; `show` → `registration().showNotification`. `install.ts`: captures `beforeinstallprompt` (`preventDefault`, keep the event), `prompt()` calls it once and reads `userChoice.outcome`; `isInstalled()` = `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`; `hint()` from the user agent (`Safari` without `Chrome|CriOS|FxiOS|Edg` → `safari-ios` on iPhone/iPad/iPod or iPadOS-as-Mac with touch, `safari-mac` on MacIntel) and `null` when installed; `subscribe` notifies on the prompt event and on `appinstalled`. `share.ts`: `navigator.canShare?.({ files })` → `share` → `'shared'`, `AbortError` → `'cancelled'`; otherwise an object-URL anchor download per file → `'downloaded'`. `haptics.ts`: `navigator.vibrate?.(10)` / `[10, 40, 10]` / `[30, 30, 30]`. `index.ts`: `export const platform: Platform = { kind: 'web', storage: createSecureStorage(), lock: createLock({ storage, rpId: location.hostname, origin: location.origin }), notifications: createWebNotifications({ registration: () => navigator.serviceWorker.ready }), share: createWebShare(), install: createWebInstall(), haptics: webHaptics }` (desktop selection added in sub-project 2).

- [ ] **Step 4: Run the specs.** Run: `npm test -- src/platform`. Expected: PASS (13 tests). If `fake-indexeddb` cannot clone a `CryptoKey` in the default-store path, the memory-store specs still prove the module; add one Playwright check in Task 9 that `secure:key` exists in IndexedDB after sign-in. `npm run verify` green.

- [ ] **Step 5: Commit and open the pull request** (`task/07-platform-adapters`, `feat: web platform adapters — encrypted storage, WebAuthn/passcode lock, push, share, install`), review, ask to merge.

### Task 8: Session, queries, app shell, sign-in and lock screens

**Files:**
- Create: `src/session/appConfig.ts`, `src/session/deviceId.ts`, `src/session/tokens.ts`, `src/session/tokens.spec.ts`, `src/session/brand.ts`, `src/session/AppSession.tsx`, `src/session/AppSession.spec.tsx`, `src/queries/client.ts`, `src/queries/account.ts`, `src/queries/portfolio.ts`, `src/queries/money.ts`, `src/queries/legacy.ts`, `src/queries/support.ts`, `src/queries/alerts.ts`, `src/queries/oracle.ts`, `src/app/providers.tsx`, `src/app/router.tsx`, `src/components/{Panel,AppShell,FlowShell,TabBar,NavRail,HeaderActions,StatusBanners,UpdateRequired,LockScreen,ConfirmSheet,Starfield,SpaceBackdrop,BrandMark,StateView,SampleRibbon}.tsx` (+ `.module.css`), `src/components/form/{Button,Input,Textarea,Switch,Select,Slider,Dialog,Sheet,Tabs,PinInput,Field}.tsx` (+ css), `src/screens/signIn/SignInScreen.tsx` (+ css), `src/screens/signIn/SignInScreen.test.tsx`, `src/screens/lock/LockSetupSheet.tsx`, `tests/e2e/sign-in.spec.ts`, `tests/e2e/lock.spec.ts`
- Modify: `src/main.tsx`, `src/app/App.tsx` (becomes the router host), `src/app/App.test.tsx`
- Reference: `.reference/plan-b/mobile/floot-app/pages/*` for copy and structure of the shell; `.reference/plan-b/.superpowers/sdd/.../harness/stubs/components/*` for the kit contracts the ported screens expect

**Interfaces:**
- Consumes: `PlatformApi`, `createSampleApi`, `createLiveApi`, `platform`, `themes`, `format`, `isBelowMinimum`.
- Produces: `appConfig = { platformUrl: string; productName: string; shortName: string; accentFallback: string; appVersion: string }` (from `import.meta.env.VITE_*` and `__APP_VERSION__` defined in `vite.config.ts` from package.json); `getDeviceId(): string` (`app.deviceId` in localStorage, 32 base64url chars); `createTokenStore(storage: SecureStorage): TokenStore & { peekAccess(): string | null }` (access in memory, refresh token under `refreshToken`); `brandCache = { read(): Brand | null; write(b: Brand): void }` (`localStorage['app.brand']`); `AppSessionProvider({ api?, platform?, children })` and `useAppSession(): { api: PlatformApi; mode: 'sample' | 'live'; status: 'loading' | 'signed-out' | 'locked' | 'signed-in'; brand: Brand | null; me: Me | null; theme: ThemeId; setTheme(id: ThemeId): void; online: boolean; lockEnabled: boolean; setLockEnabled(on: boolean): Promise<boolean>; signIn(tokens: MobileTokens): Promise<void>; enterSample(): Promise<void>; signOut(): Promise<void>; lock(): void; unlock(): Promise<boolean>; confirm(reason: string, opts?: { amountCents?: number; currency?: string }): Promise<boolean>; updateRequired: string | null }`; query hooks (`useBrand, useMe, useDashboard, useInvestments, useInvestment(id), useStrategies, useHistory, useStatements(kind), useStatement(period), useAlerts, useTickets(page), useTicket(id), useDepositOverview, useWithdrawals, useTransfers, useKyc, useLegacyPlan, useBeneficiaries, useSessions`) and mutations (`useSetNotificationPrefs, useChangePassword, useSetPin, useRevokeSession, useEnrollTwoFactor, useEnableTwoFactor, useDisableTwoFactor, useCloseAccount, useMarkRead, useOpenTicket, useReplyTicket, useManualDeposit, useCardDeposit, useRequestWithdrawal, useSendTransfer, useInvest, useMaturityChoice, useSubmitKyc, useSaveLegacyPlan, useAddBeneficiary, useUpdateBeneficiary, useRemoveBeneficiary, useOracleAsk`) each invalidating the queries it changes; components: `AppShell` (tab layout; header with `BrandMark`, `HeaderActions`; `StatusBanners`; `TabBar` below 900 px / `NavRail` at 900 px+), `FlowShell` (back, title, actions, no tab bar), `StateView({ kind: 'loading' | 'empty' | 'error' | 'offline'; title?; detail?; action?: { label; onClick }; lines?: number })`, `ConfirmSheet` (rendered by the provider; `confirm()` resolves its promise), `LockScreen`, `UpdateRequired`, `SampleRibbon`, the form kit over `radix-ui` (`Button` variants `primary | outline | ghost | destructive`, sizes `sm | md | lg`; `Input`, `Textarea` forward refs; `Switch` with `onCheckedChange`; `Select`; `Slider` with `value: number[]`; `Dialog`, `Sheet` (bottom sheet on phones, side panel at 900 px+), `Tabs`, `PinInput({ length: 4 | 6 | 8 })`, `Field({ label; error; hint })`).
- Routes (`router.tsx`): `/sign-in`, `/` (Home placeholder until Task 10), with every other route added by its task; signed-out visitors of any non-sign-in route are redirected to `/sign-in?next=`; `LockScreen` overlays the app while `status === 'locked'`; `UpdateRequired` replaces the app while `updateRequired` is set.

- [ ] **Step 1: Write the failing specs.** `src/session/tokens.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTokenStore } from './tokens';
import { createSecureStorage, type KvStore } from '../platform/web/storage';

const memory = (): KvStore => { const m = new Map<string, unknown>(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] }; };
const pair = { tokenType: 'Bearer' as const, accessToken: 'a1', refreshToken: 'r1', accessExpiresAt: '2026-10-01T12:15:00.000Z', refreshExpiresAt: '2026-10-31T12:00:00.000Z' };

describe('token store', () => {
  it('keeps the access token in memory and the refresh token in secure storage', async () => {
    const db = memory();
    const store = createTokenStore(createSecureStorage({ db }));
    await store.set(pair);
    expect(store.peekAccess()).toBe('a1');
    const again = createTokenStore(createSecureStorage({ db }));
    const t = await again.get();
    expect(t?.refreshToken).toBe('r1');
    expect(t?.accessToken).toBe(''); // gone with the old instance: the first call refreshes
    await again.set(null);
    expect(await again.get()).toBeNull();
  });
});
```

`src/session/AppSession.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSessionProvider, useAppSession } from './AppSession';
import { createSampleApi } from '../api/createSampleApi';
import type { Platform } from '../platform/types';

function fakePlatform(overrides: Partial<Platform['lock']> = {}): Platform {
  const mem = new Map<string, string>();
  return {
    kind: 'web',
    storage: { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, remove: async (k) => { mem.delete(k); }, clear: async () => mem.clear() },
    lock: { available: async () => 'passcode', enrolled: async () => 'passcode', enrollWebAuthn: async () => {}, enrollPasscode: async () => {}, verify: async () => true, verifyPasscode: async (c) => ({ ok: c === '246810', attemptsLeft: 5 }), clear: async () => {}, ...overrides },
    notifications: { permission: () => 'unsupported', request: async () => 'unsupported', subscribe: async () => { throw new Error('unsupported'); }, unsubscribe: async () => null, show: async () => {} },
    share: { files: async () => 'downloaded' },
    install: { canPrompt: () => false, prompt: async () => 'unavailable', isInstalled: () => false, hint: () => null, subscribe: () => () => {} },
    haptics: { tick() {}, success() {}, warn() {} },
  };
}

function Probe() {
  const s = useAppSession();
  return (
    <div>
      <output data-testid="status">{s.status}</output>
      <output data-testid="online">{String(s.online)}</output>
      <output data-testid="brand">{s.brand?.name ?? ''}</output>
      <button onClick={() => void s.enterSample()}>enter</button>
      <button onClick={() => s.lock()}>lock now</button>
      <button onClick={() => void s.unlock()}>unlock</button>
      <button onClick={() => void s.setLockEnabled(false)}>lock off</button>
      <button onClick={() => void s.confirm('Send $10.00 to $grace').then((ok) => { document.title = ok ? 'confirmed' : 'cancelled'; })}>confirm</button>
      <button onClick={() => void s.signOut()}>sign out</button>
    </div>
  );
}

const hidden = (value: 'hidden' | 'visible') => { Object.defineProperty(document, 'visibilityState', { value, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };

describe('AppSession', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts signed out, enters sample mode and applies the brand theme', async () => {
    render(<AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}><Probe /></AppSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('brand').textContent?.length).toBeGreaterThan(0);
    expect(document.documentElement.dataset.theme).toBe('orbital');
  });

  it('locks after five minutes hidden unless the lock is off, and always on lock now', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}><Probe /></AppSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    act(() => { hidden('hidden'); vi.advanceTimersByTime(4 * 60 * 1000); hidden('visible'); });
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    act(() => { hidden('hidden'); vi.advanceTimersByTime(5 * 60 * 1000 + 1); hidden('visible'); });
    expect(screen.getByTestId('status')).toHaveTextContent('locked');
    await user.click(screen.getByText('unlock'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await user.click(screen.getByText('lock off')); // asks for a confirmation first; the fake lock verifies
    act(() => { hidden('hidden'); vi.advanceTimersByTime(6 * 60 * 1000); hidden('visible'); });
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    await user.click(screen.getByText('lock now'));
    expect(screen.getByTestId('status')).toHaveTextContent('locked');
  });

  it('tracks the network and goes back online without a reload', async () => {
    render(<AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}><Probe /></AppSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('true'));
    act(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); window.dispatchEvent(new Event('offline')); });
    expect(screen.getByTestId('online')).toHaveTextContent('false');
    act(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); window.dispatchEvent(new Event('online')); });
    expect(screen.getByTestId('online')).toHaveTextContent('true');
  });

  it('shows the confirmation sheet with the reason and resolves true or false', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform({ verifyPasscode: async () => ({ ok: false, attemptsLeft: 4 }) })}><Probe /></AppSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await user.click(screen.getByText('confirm'));
    expect(await screen.findByRole('dialog', { name: 'Confirm' })).toHaveTextContent('Send $10.00 to $grace');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.title).toBe('cancelled'));
  });

  it('lands on sign-in when the session was revoked while locked', async () => {
    const api = createSampleApi({ latencyMs: 0 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AppSessionProvider api={api} platform={fakePlatform()}><Probe /></AppSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await user.click(screen.getByText('enter'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await user.click(screen.getByText('lock now'));
    act(() => { (api as unknown as { _test_revoke: () => void })._test_revoke(); }); // every later call answers 401 session_revoked
    await user.click(screen.getByText('unlock')); // unlock refetches /me, which now fails
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(screen.getByTestId('brand').textContent?.length).toBeGreaterThan(0); // the public brand survives
  });

  it('shows the update screen when the platform requires a newer app', async () => {
    render(<AppSessionProvider api={createSampleApi({ latencyMs: 0, minSupportedAppVersion: '99.0.0' })} platform={fakePlatform()}><Probe /></AppSessionProvider>);
    expect(await screen.findByRole('heading', { name: 'Update the app' })).toBeInTheDocument();
  });
});
```

`src/screens/signIn/SignInScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('SignInScreen', () => {
  it('offers sample exploration and the two-factor hint in sample mode', async () => {
    renderWithApp({ route: '/sign-in' });
    expect(await screen.findByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
    expect(screen.getByText(/add \+2fa to try the two-factor step/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('target', '_blank');
  });
  it('shows the platform message on a wrong two-factor code', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/sign-in' });
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Six-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });
});
```

(`src/test/renderWithApp.tsx` is shared by every screen test: `renderWithApp({ route: string; signedIn?: boolean; latencyMs?: number; platform?: { [K in keyof Platform]?: Partial<Platform[K]> } }): { api: PlatformApi }` renders the real providers over `createSampleApi({ latencyMs: latencyMs ?? 0 })`, the fake platform from the AppSession spec (moved to `src/test/fakePlatform.ts`, deep-merged with `platform`), the real router in a `MemoryRouter` at `route`, and — when `signedIn` — enters the sample session before rendering the route.)

`tests/e2e/sign-in.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('explores the sample world', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Sample', { exact: true })).toBeVisible();
});

test('signs in with the two-factor step', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('investor+2fa@sample.app');
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Six-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not valid.');
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/');
});

test('create account opens the company website in a new tab', async ({ page, context }) => {
  await page.goto('/sign-in');
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Create account' }).click();
  expect((await popup).url()).toContain('example.com');
});

test('an outdated app sees the update screen and can still sign out', async ({ page }) => {
  await page.goto('/sign-in?sampleMinVersion=99.0.0');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page.getByRole('heading', { name: 'Update the app' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
```

`tests/e2e/lock.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('locks after five minutes in the background and unlocks with the passcode', async ({ page }) => {
  await page.clock.install();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.getByRole('button', { name: 'Set a passcode' }).click(); // the lock-setup sheet offered on first sign-in (passcode path in headless Chromium)
  await page.getByLabel('Passcode').fill('246810');
  await page.getByLabel('Repeat passcode').fill('246810');
  await page.getByRole('button', { name: 'Save passcode' }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward('05:01');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('heading', { name: 'Locked' })).toBeVisible();
  await page.getByLabel('Passcode').fill('000000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('4 attempts left');
  await page.getByLabel('Passcode').fill('246810');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Locked' })).toBeHidden();
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/session src/screens/signIn`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `AppSession.tsx`: on mount, read the cached brand and apply it; create the api (`props.api` → else `appConfig.platformUrl ? createLiveApi({ baseUrl: platformUrl + '/api/mobile/v1', tokenStore, app: { version: appVersion, platform: 'web', deviceId: getDeviceId(), deviceName }, onSignedOut, onUpgradeRequired }) : createSampleApi()`); load `brand()` (`updateRequired` when `isBelowMinimum(appVersion, brand.minSupportedAppVersion)`), apply `brand.defaultTheme` unless `app.theme` is set, `themes.apply(theme, brand.accentHex)`; a stored refresh token (live) or the sample flag (`sessionStorage['app.sample']`) → `status: 'locked'` if the lock is enrolled and enabled, else `'signed-in'`; `me()` loaded after sign-in; `visibilitychange` starts a 5-minute timer when hidden and, if it expired before visible, sets `'locked'` (when `lockEnabled`); `lock()` sets `'locked'` unconditionally; `unlock()` → `platform.lock.verify()` (webauthn) or renders the passcode form inside `LockScreen` (`verifyPasscode`; `attemptsLeft: 0` → `signOut()`); `confirm(reason)` renders `ConfirmSheet` (reason, optional amount via `format.money`, "Confirm" runs the same adapter, "Cancel" resolves false; when the lock is not enrolled the sheet offers the lock-setup first); `setLockEnabled(false)` requires `confirm('Turn off the app lock')`; `signOut()` → `api.logout()`, `tokenStore.set(null)`, `platform.notifications.unsubscribe()` best effort, `queryClient.clear()`, status `'signed-out'`; `onSignedOut` from the live client does the same without calling `logout`; the QueryClient's `queryCache.onError` and `mutationCache.onError` run the same local sign-out whenever any call fails with `session_revoked` (so a sample-mode `_test_revoke()` and a live revocation discovered at unlock both land on sign-in); `unlock()` refetches `me` after a successful verification. `AppSession` creates the sample api with options read from the URL once per launch: `?sampleStress=1`, `?sampleLatency=<ms>`, `?sampleMinVersion=<semver>`. `UpdateRequired` renders an `<h1>Update the app</h1>` and a "Sign out" button. `online` from `navigator.onLine` + events, mirrored into TanStack's `onlineManager.setOnline`. `client.ts`: `new QueryClient({ defaultOptions: { queries: { networkMode: 'online', staleTime: 30_000, retry: (n, e) => !(MobileApiError.is(e) && e.status < 500) && n < 2, gcTime: 5 * 60_000 }, mutations: { networkMode: 'online' } }, queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }) })`. Query hooks use `useAppSession().api` and key on `[mode, name, ...args]`. Shell components port the Plan B page shells' structure and copy; `SampleRibbon` renders "Sample" when `mode === 'sample'`; `HeaderActions` bell (`useAlerts` unread badge → `/alerts`) and orb (`/oracle`). `SignInScreen` per the spec's screen table; sample-mode "Explore with sample data" → `enterSample()`; after any first sign-in on a device without an enrolled lock, `LockSetupSheet` offers "Use Face ID / Touch ID / Windows Hello" (when `available() === 'webauthn'`) or "Set a passcode", with "Not now". `router.tsx` with `createBrowserRouter` and a `RequireSession` layout route; `App.tsx` = `<RouterProvider router={router} />`; `App.test.tsx` now asserts the sign-in screen renders for a signed-out visitor.

- [ ] **Step 4: Run the specs and the e2e.** Run: `npm test -- src/session src/screens src/app`. Expected: PASS (1 + 6 + 2 + 1 tests). Then `npm run build && npx playwright test tests/e2e/sign-in.spec.ts tests/e2e/lock.spec.ts --project=phone-chromium`. Expected: 5 passed.

- [ ] **Step 5: Commit and open the pull request** (`task/08-session-shell`, `feat: app session, query hooks, shell, sign-in and lock screens`), review, ask to merge.

### Task 9: Installable PWA — service worker, update toast, install button, push handlers, installability checks

**Files:**
- Create: `src/sw.ts`, `src/components/UpdateToast.tsx`, `src/components/UpdateToast.test.tsx`, `src/components/InstallButton.tsx`, `src/components/InstallButton.test.tsx`, `src/pwa/register.ts`, `scripts/screenshots.ts`, `public/screenshots/phone-home.png`, `public/screenshots/desktop-home.png`, `lighthouserc.json`, `tests/e2e/pwa.spec.ts`, `tests/e2e/offline.spec.ts`
- Modify: `vite.config.ts`, `src/app/providers.tsx` (mount `UpdateToast`), `src/screens/signIn/SignInScreen.tsx` (mount `InstallButton`), `src/session/AppSession.tsx` (push subscribe after sign-in when `brand.vapidPublicKey` and permission granted), `src/app/router.tsx` (`/alerts?open=` handled in Task 15; until then the SW's click URL still resolves to `/alerts` → redirect to `/`)

**Interfaces:**
- Produces: `vite.config.ts` with `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'prompt', injectRegister: false, manifest: buildManifest(loadCompanyConfig()), injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'], maximumFileSizeToCacheInBytes: 4_000_000 }, devOptions: { enabled: false } })` and `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`; `UpdateToast` (uses `useRegisterSW` from `virtual:pwa-register/react`: shows "Update available" with "Reload" when `needRefresh`, calls `updateServiceWorker(true)`); `InstallButton({ placement: 'sign-in' | 'profile' })` (renders the button when `platform.install.canPrompt()`, the Safari hint text when `hint()` is set, nothing when installed); the SW handles `push` and `notificationclick`.

- [ ] **Step 1: Write the failing tests.** `src/components/UpdateToast.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const update = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [true, () => {}], offlineReady: [false, () => {}], updateServiceWorker: update }) }));
import { UpdateToast } from './UpdateToast';

describe('UpdateToast', () => {
  it('offers to reload when a new version is waiting', async () => {
    render(<UpdateToast />);
    expect(screen.getByRole('status')).toHaveTextContent('Update available');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(update).toHaveBeenCalledWith(true);
  });
});
```

`src/components/InstallButton.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstallButton } from './InstallButton';
import type { InstallAdapter } from '../platform/types';

const adapter = (o: Partial<InstallAdapter>): InstallAdapter => ({ canPrompt: () => false, prompt: async () => 'unavailable', isInstalled: () => false, hint: () => null, subscribe: () => () => {}, ...o });

describe('InstallButton', () => {
  it('shows the button when a prompt is available', () => {
    render(<InstallButton placement="sign-in" install={adapter({ canPrompt: () => true })} />);
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
  });
  it('shows the Safari hint instead of a button', () => {
    render(<InstallButton placement="sign-in" install={adapter({ hint: () => 'safari-ios' })} />);
    expect(screen.getByText(/Share → Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders nothing once installed or when nothing applies', () => {
    const { container } = render(<InstallButton placement="profile" install={adapter({ isInstalled: () => true, canPrompt: () => true })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`tests/e2e/pwa.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('serves a valid manifest and registers the service worker', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Investor App');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  await page.goto('/sign-in');
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(sw).toContain('/sw.js');
  expect(await page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.headers.get('content-type')))).toContain('application/manifest+json');
});

test('is installable according to Chrome', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP is Chromium only');
  await page.goto('/sign-in');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('shows the Safari hint in WebKit', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit');
  await page.goto('/sign-in');
  await expect(page.getByText(/Add to Home Screen|Add to Dock/)).toBeVisible();
});

test('keeps the refresh token encrypted in IndexedDB', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  const hasKey = await page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('investor-app');
    open.onsuccess = () => { const db = open.result; if (!db.objectStoreNames.contains('secure')) return resolve(false); const req = db.transaction('secure').objectStore('secure').get('secure:key'); req.onsuccess = () => resolve(req.result instanceof CryptoKey && req.result.extractable === false); req.onerror = () => resolve(false); };
    open.onerror = () => resolve(false);
  }));
  expect(hasKey).toBe(true);
});
```

`tests/e2e/offline.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('opens the shell offline, hides balances and recovers', async ({ page, context }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page.getByText('Sample', { exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status', { name: 'Connection' })).toHaveText(/You're offline/);
  await expect(page.locator('[data-amount]').first()).toHaveText('•••');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status', { name: 'Connection' })).toBeHidden();
  await expect(page.locator('[data-amount]').first()).not.toHaveText('•••');
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/components/UpdateToast src/components/InstallButton`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.** `vite.config.ts` as above (reads `company.config.json` with `loadCompanyConfig`). `src/sw.ts`:

```ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/_api\//] }));

self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting(); });

self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? {}) as { notificationId?: string; title?: string };
  event.waitUntil(self.registration.showNotification(data.title ?? 'New alert', { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: data.notificationId, data: { notificationId: data.notificationId } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = (event.notification.data as { notificationId?: string } | undefined)?.notificationId;
  const url = id ? `/alerts?open=${encodeURIComponent(id)}` : '/alerts';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((c) => 'focus' in c);
    if (client) { await client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
```

`src/pwa/register.ts` re-exports `useRegisterSW`; `UpdateToast` uses it with `onRegisteredSW(url, registration)` scheduling `registration.update()` every hour and renders a `role="status"` toast; `InstallButton` takes `install` (default `platform.install`) and subscribes for changes; `StatusBanners` renders the offline banner as `role="status"` `aria-label="Connection"`; `Amount`/`CountUp` (Task 10) carry `data-amount` — until then the Home placeholder renders one `<span data-amount>` through a minimal `Amount` created now in `src/components/Amount.tsx` (`•••` when offline, else `format.money`). Push: in `AppSession`, after sign-in when `brand.vapidPublicKey` and `platform.notifications.permission() === 'granted'`, `subscribe(key)` → `api.pushSubscribe`; the alert-preferences screen (Task 14) requests permission. `scripts/screenshots.ts`: Playwright script that builds, serves `dist`, signs into the sample world and saves `public/screenshots/phone-home.png` (1080×1920 at device scale 3 on a 360×640 viewport) and `desktop-home.png` (1920×1080); run it once and commit the PNGs. `lighthouserc.json`:

```json
{ "ci": { "collect": { "staticDistDir": "./dist", "isSinglePageApplication": true, "url": ["http://localhost/sign-in"], "numberOfRuns": 1, "settings": { "preset": "desktop" } },
          "assert": { "assertions": { "installable-manifest": "error", "service-worker": "error", "maskable-icon": "error", "themed-omnibox": "warn" } },
          "upload": { "target": "temporary-public-storage" } } }
```

(after `npm install`, run `npx lighthouse --list-all-audits | grep installable-manifest`; if the bundled Lighthouse lacks it, pin `@lhci/cli@0.13.0` explicitly — it ships Lighthouse 11 — and record the version in `CLAUDE.md`).

- [ ] **Step 4: Run everything.** Run: `npm test -- src/components`. Expected: PASS (4 tests). `npm run build && npx playwright test tests/e2e/pwa.spec.ts tests/e2e/offline.spec.ts`. Expected: 6 passed, 1 skipped per project as applicable. `npm run lhci`. Expected: all assertions pass (`installable-manifest`, `service-worker`, `maskable-icon`).

- [ ] **Step 5: Commit and open the pull request** (`task/09-pwa`, `feat: installable PWA with precached shell, update prompt, install button and push handlers`), review, ask to merge.

### Task 10: Home and the shared visuals

**Files:**
- Create: `src/components/{CountUp,OrbitalRing,ValueChart,ProgressRing}.tsx` (+ css), `src/components/CountUp.test.tsx`, `src/components/OrbitalRing.test.tsx`, `src/components/ValueChart.test.tsx`, `src/screens/home/HomeScreen.tsx` (+ css), `src/screens/home/HomeScreen.test.tsx`, `tests/e2e/home.spec.ts`
- Modify: `src/components/Amount.tsx` (full version), `src/app/router.tsx` (`/` → `HomeScreen`)
- Reference: `.reference/plan-b/mobile/floot-app/components/ProgressRing.tsx`, the Plan B Home description in the spec

**Interfaces:**
- Consumes: `useDashboard`, `useAlerts`, `useAppSession`, `format`, `useMotion`, `StateView`, `Panel`.
- Produces: `Amount({ cents, currency?, compact?, signed?, className? })` → `<span data-amount class="tabular">` ("•••" when offline); `CountUp({ cents, currency?, durationMs = 900 })` (animates from the previous value; renders the final value immediately when `useMotion().animate` is false); `OrbitalRing({ slices: { label; sector; valueCents; percent; color? }[], size? })` (SVG ring of glowing arcs with a legend and a visually hidden `<table>` of the same data); `ValueChart({ points: { date; valueCents }[], basis: 'projection' | 'actual', ranges?: ('1M' | '3M' | '1Y' | 'All')[], today?: string })` (recharts area with the accent gradient; range tabs; dashed future segment and a "Today" marker when `basis === 'projection'`; a "Projection" caption); `ProgressRing({ percent, size?, label })`.

- [ ] **Step 1: Write the failing tests.** `src/components/CountUp.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../design/useMotion', () => ({ useMotion: () => ({ animate: false }) }));
import { CountUp } from './CountUp';

describe('CountUp', () => {
  it('renders the final value immediately under reduced motion', () => {
    render(<CountUp cents={123456} />);
    expect(screen.getByText('$1,234.56')).toHaveAttribute('data-amount');
  });
});
```

`src/components/OrbitalRing.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrbitalRing } from './OrbitalRing';

describe('OrbitalRing', () => {
  it('draws one arc per slice and an accessible table', () => {
    render(<OrbitalRing slices={[{ label: 'Energy', sector: 'Energy', valueCents: 600000, percent: 60 }, { label: 'Aerospace', sector: 'Aerospace', valueCents: 400000, percent: 40 }]} />);
    expect(screen.getByRole('img', { name: /allocation/i })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Energy');
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
```

`src/components/ValueChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValueChart } from './ValueChart';

const points = Array.from({ length: 24 }, (_, i) => ({ date: new Date(Date.UTC(2026, i - 12, 1)).toISOString(), valueCents: 1000000 + i * 25000 }));

describe('ValueChart', () => {
  it('labels projections and offers the four ranges', () => {
    render(<ValueChart points={points} basis="projection" today="2026-10-01T00:00:00.000Z" />);
    expect(screen.getByText('Projection')).toBeInTheDocument();
    for (const r of ['1M', '3M', '1Y', 'All']) expect(screen.getByRole('tab', { name: r })).toBeInTheDocument();
  });
});
```

`src/screens/home/HomeScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../../test/renderWithApp';

describe('HomeScreen', () => {
  it('greets the investor and shows the projected value, allocation and next steps', async () => {
    renderWithApp({ route: '/', signedIn: true });
    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), alex/i })).toBeInTheDocument();
    expect(screen.getByText('Portfolio value')).toBeInTheDocument();
    expect(screen.getAllByText('Projection').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /allocation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /legacy plan/i })).toHaveAttribute('href', '/legacy');
  });
  it('shows skeletons while loading and the error state with retry', async () => {
    renderWithApp({ route: '/', signedIn: true, latencyMs: 400 });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('Portfolio value')).toBeInTheDocument();
  });
});
```

`tests/e2e/home.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('home shows the sample investor', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page.getByText('Portfolio value')).toBeVisible();
  await expect(page.locator('[data-amount]').first()).toHaveText(/^\$[\d,]+\.\d{2}$/);
  await expect(page.getByRole('img', { name: /allocation/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: '1Y' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(5); // Task 16 makes this viewport-aware (7 on the rail)
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/components src/screens/home`. Expected: FAIL — modules missing.

- [ ] **Step 3: Implement** per the spec's Home row: greeting by local hour with first name and tier chip; `CountUp` for `totals.portfolioValueCents` with the Projection caption; deployed and modelled earnings as compact money; cash and wallets; `OrbitalRing` from `dashboard.allocation`; `ValueChart` from `dashboard.performance.points` (ranges look back from today; "All" runs the full series with the future dashed); KPI chips from `dashboard.kpis`; next-step cards from `dashboard.nextSteps` linking by `target` (`kyc` → `/profile/verification`, `legacy` → `/legacy`, `maturity` → `/move`, `activity` → `/portfolio?tab=activity`, `invest` → `/move/invest`); latest three alerts linking to `/alerts`. Loading: `StateView kind="loading"` skeletons in the same layout (`role="status" aria-label="Loading"`); error: `StateView kind="error"` with retry (`refetch`); empty (no positions): zeros, no chart, a "Make your first investment" card. `TabBar` is `<nav aria-label="Main">` with five links. Haptic tick on pull-to-refresh (`haptics.tick()` on `refetch`).

- [ ] **Step 4: Run the tests.** Run: `npm test -- src/components src/screens/home`. Expected: PASS. `npm run build && npx playwright test tests/e2e/home.spec.ts`. Expected: passed on all three projects.

- [ ] **Step 5: Commit and open the pull request** (`task/10-home`, `feat: Home with count-up value, allocation ring and projection chart`), review, ask to merge.

### Task 11: Portfolio, holding detail, statements and the statement PDF

**Files:**
- Create: `src/lib/statementPdf.ts`, `src/lib/statementPdf.spec.ts`, `src/screens/portfolio/PortfolioScreen.tsx` (+ css, test), `src/screens/holding/HoldingScreen.tsx` (+ css), `src/screens/statement/StatementScreen.tsx` (+ css, test), `tests/e2e/portfolio.spec.ts`
- Modify: `src/app/router.tsx` (`/portfolio`, `/portfolio/:positionId`, `/statements/:periodKey`)
- Reference: `.reference/plan-b/mobile/floot-app/pages/{portfolio,portfolio.$positionId,statements.$periodKey}.tsx` (+ css), `helpers/shareFile.tsx`, `helpers/flowHeader.tsx`

**Interfaces:**
- Consumes: `useInvestments`, `useInvestment`, `useHistory`, `useStatements`, `useStatement`, `api.statementCsv`, `useRequestWithdrawal`, `useAppSession().confirm`, `platform.share`, `ValueChart`, `ProgressRing`, `StateView`, `Tabs`.
- Produces: `statementPdf(statement: StatementDetail, brand: { name: string; accentHex: string }): TDocumentDefinitions` (pdfmake); `renderStatementPdf(statement, brand): Promise<File>` (lazy-imports pdfmake and its fonts; returns `statement-<periodKey>.pdf`).

- [ ] **Step 1: Write the failing spec** — `src/lib/statementPdf.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { statementPdf } from './statementPdf';
import { sampleData } from '../sample/sampleData';

describe('statementPdf', () => {
  it('brands the statement and lists every line', () => {
    const statement = sampleData.createState().statement;
    const doc = statementPdf(statement, { name: 'Northwind Wealth', accentHex: '#3366FF' });
    const text = JSON.stringify(doc.content);
    expect(text).toContain('Northwind Wealth');
    expect(text).toContain(statement.period.label);
    expect(text).toContain(statement.holder.fullName);
    for (const line of statement.lines) expect(text).toContain(line.description);
    expect(text).toContain('Projection');
    expect(text).toContain('Generated on your device from platform records');
    expect(JSON.stringify(doc.styles)).toContain('#3366FF');
  });
});
```

`src/screens/statement/StatementScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('StatementScreen', () => {
  it('shares the PDF through the platform share adapter', async () => {
    const user = userEvent.setup();
    const files = vi.fn(async () => 'shared' as const);
    renderWithApp({ route: '/portfolio?tab=statements', signedIn: true, platform: { share: { files } } });
    await user.click((await screen.findAllByRole('link', { name: /\d{4}/ }))[0]!); // the newest period; sample data is dated relative to today
    await user.click(await screen.findByRole('button', { name: 'Share PDF' }));
    await vi.waitFor(() => expect(files).toHaveBeenCalled());
    const [[sharedFiles]] = files.mock.calls as unknown as [[File[]]];
    expect(sharedFiles[0]!.name).toMatch(/^statement-\d{4}-(\d{2}|Q[1-4])\.pdf$/);
    expect(sharedFiles[0]!.type).toBe('application/pdf');
  });
});
```

`tests/e2e/portfolio.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/sign-in'); await page.getByRole('button', { name: 'Explore with sample data' }).click(); });

test('holdings, activity and statements tabs', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('tab', { name: 'Holdings', selected: true })).toBeVisible();
  await expect(page.getByText('Matured')).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText(/\w+ \d{4}/);
  await page.getByRole('tab', { name: 'Statements' }).click();
  await page.getByRole('link', { name: /\d{4}/ }).first().click(); // periods are relative to today, never hard-coded
  await expect(page).toHaveURL(/\/statements\/\d{4}-(\d{2}|Q[1-4])/);
  await expect(page.getByRole('button', { name: 'Share CSV' })).toBeVisible();
});

test('holding detail offers a withdrawal with confirmation', async ({ page }) => {
  await page.goto('/portfolio');
  await page.getByRole('link', { name: /Real Estate/ }).click();
  await expect(page.getByText('Progress to maturity')).toBeVisible();
  await page.getByRole('button', { name: 'Request withdrawal' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm' })).toContainText('Withdraw');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/lib/statementPdf src/screens/statement`. Expected: FAIL.

- [ ] **Step 3: Implement.** `statementPdf.ts`: header with company name and an accent rule (style `brandRule` with `fillColor: accentHex`), holder and period, opening/closing cash, totals, lines table (In/Out/Info), positions table captioned "Projection", footer "Generated on your device from platform records"; `renderStatementPdf` with `const pdfMake = (await import('pdfmake/build/pdfmake')).default` and `(await import('pdfmake/build/vfs_fonts'))` then `createPdf(doc).getBlob()` → `File`. Screens per the spec's table, ported from the Plan B pages (replace Floot kit imports with `src/components/form`, `useSearchParams` for `?tab=`, `FlowShell` for the detail pages); "Share PDF" → `renderStatementPdf` → `platform.share.files([file], 'Statement')`; "Share CSV" → `api.statementCsv(period)` → a `text/csv` `File` the same way; withdrawal on a holding → `confirm(\`Withdraw ${plan}\`)` → `useRequestWithdrawal({ kind: 'position', investmentId })`.

- [ ] **Step 4: Run the tests.** `npm test -- src/lib src/screens`. Expected: PASS. `npm run build && npx playwright test tests/e2e/portfolio.spec.ts`. Expected: passed.

- [ ] **Step 5: Commit and open the pull request** (`task/11-portfolio`, `feat: Portfolio, holding detail and statements with on-device PDF`), review, ask to merge.

### Task 12: Move — hub, deposit, withdraw, transfer, invest, maturity choices

**Files:**
- Create: `src/components/AmountField.tsx` (+ css), `src/lib/amountInput.ts`, `src/lib/amountInput.spec.ts`, `src/screens/move/MoveScreen.tsx`, `src/screens/deposit/DepositScreen.tsx`, `src/screens/withdraw/WithdrawScreen.tsx`, `src/screens/transfer/TransferScreen.tsx`, `src/screens/transfer/TransferScreen.test.tsx`, `src/screens/invest/InvestScreen.tsx` (each + css), `tests/e2e/move.spec.ts`
- Modify: `src/app/router.tsx` (`/move`, `/move/deposit`, `/move/withdraw`, `/move/transfer`, `/move/invest`)
- Reference: `.reference/plan-b/mobile/floot-app/pages/move*.tsx` (+ css), `components/AmountField.tsx`

**Interfaces:**
- Consumes: `useDashboard`, `useInvestments`, `useDepositOverview`, `useWithdrawals`, `useTransfers`, `useStrategies`, the money mutations, `useAppSession().confirm`, `useBrand().features`, `PinInput`.
- Produces: `parseAmount(input: string): { cents: number } | { error: string }` (accepts `1,234.56`, `1234`, `$12.50`; rejects more than two decimals, negatives, empty); `AmountField({ value: number | null; onChange(cents | null); currency?; min?; max?; label; error? })`.

- [ ] **Step 1: Write the failing tests.** `src/lib/amountInput.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAmount } from './amountInput';

describe('parseAmount', () => {
  it('parses dollars into cents', () => {
    expect(parseAmount('1,234.56')).toEqual({ cents: 123456 });
    expect(parseAmount('$12.5')).toEqual({ cents: 1250 });
    expect(parseAmount('100')).toEqual({ cents: 10000 });
  });
  it('rejects bad input with a plain message', () => {
    expect(parseAmount('')).toEqual({ error: 'Enter an amount.' });
    expect(parseAmount('-5')).toEqual({ error: 'Enter an amount above zero.' });
    expect(parseAmount('1.234')).toEqual({ error: 'Use at most two decimals.' });
    expect(parseAmount('abc')).toEqual({ error: 'Enter a number.' });
  });
});
```

`src/screens/transfer/TransferScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('TransferScreen', () => {
  it('points to Security when no PIN is set and sends after confirmation', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/move/transfer', signedIn: true });
    await user.type(await screen.findByLabelText('Recipient'), '$grace');
    await user.type(screen.getByLabelText('Amount'), '10');
    await user.type(screen.getByLabelText('Transfer PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('link', { name: 'Set a transfer PIN' })).toHaveAttribute('href', '/profile/security');
  });
});
```

`tests/e2e/move.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/sign-in'); await page.getByRole('button', { name: 'Explore with sample data' }).click(); });

test('deposit notice files a pending request', async ({ page }) => {
  await page.goto('/move/deposit');
  await expect(page.getByRole('img', { name: /QR/ })).toBeVisible();
  await page.getByRole('button', { name: "I've sent it" }).click();
  await page.getByLabel('Amount').fill('500');
  await page.getByLabel('Reference').fill('tx-e2e');
  await page.getByRole('button', { name: 'Submit notice' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Pending review')).toBeVisible();
});

test('transfer needs a PIN, then succeeds', async ({ page }) => {
  await page.goto('/profile/security');
  await page.getByRole('button', { name: 'Set a transfer PIN' }).click();
  await page.getByLabel('Current password').fill('sample');
  await page.getByLabel('New PIN').fill('2468');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await page.goto('/move/transfer');
  await page.getByLabel('Recipient').fill('$grace');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Transfer PIN').fill('2468');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Sent to $grace')).toBeVisible();
});

test('invest sheet respects the minimum and succeeds', async ({ page }) => {
  await page.goto('/move/invest');
  await page.getByRole('button', { name: /Invest in/ }).first().click();
  await page.getByLabel('Amount').fill('1');
  await expect(page.getByText(/Minimum is \$/)).toBeVisible();
  await page.getByLabel('Amount').fill('5000');
  await page.getByRole('button', { name: 'Invest now' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Investment placed')).toBeVisible();
});

test('maturity choice reinvests', async ({ page }) => {
  await page.goto('/move');
  await page.getByRole('button', { name: 'Reinvest' }).first().click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Pending maturity choices')).toBeHidden();
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test -- src/lib/amountInput src/screens/transfer`. Expected: FAIL.

- [ ] **Step 3: Implement** per the spec's Move rows, porting the Plan B pages (hub with cash balance and four large actions; deposit methods with copyable fields and the QR image `alt="QR code for <method>"`; "I've sent it" form → `confirm` → `useManualDeposit` → "Pending review"; card top-up when `instant !== 'unavailable'` opening `url` in a new tab, sample mode says it credited immediately; withdraw cash (≤ balance) and matured positions; transfer with `PinInput length={4}`-to-8, `pin_required` → inline link "Set a transfer PIN" to `/profile/security`; invest sheet with `AmountField` min/max, `confirm` → `useInvest` → "Investment placed"; maturity cards with Reinvest/Withdraw → `confirm` → `useMaturityChoice`). Success copy: "Sent to <recipient>", "Investment placed", "Pending review". Deposit hidden with an explanatory card when `features.deposits` is false.

- [ ] **Step 4: Run the tests.** `npm test -- src/lib src/screens`. Expected: PASS. `npm run build && npx playwright test tests/e2e/move.spec.ts`. Expected: passed. (The transfer e2e depends on the Security screen's PIN form, delivered in Task 14 — until then it is marked `test.fixme` with a note, and un-fixed in Task 14.)

- [ ] **Step 5: Commit and open the pull request** (`task/12-move`, `feat: Move — deposits, withdrawals, transfers, investing and maturity choices`), review, ask to merge.

### Task 13: Legacy Studio

**Files:**
- Create: `src/components/LegacyProjection.tsx` (+ css), `src/components/BeneficiaryEditor.tsx` (+ css), `src/screens/legacy/LegacyScreen.tsx` (+ css), `src/screens/legacy/LegacyScreen.test.tsx`, `tests/e2e/legacy.spec.ts`
- Modify: `src/app/router.tsx` (`/legacy`)
- Reference: `.reference/plan-b/mobile/floot-app/pages/legacy.tsx` (+ css), `components/{LegacyProjection,BeneficiaryEditor}.tsx`

**Interfaces:**
- Consumes: `useLegacyPlan`, `useBeneficiaries`, `legacyPlanModel`, `api.previewLegacyPlan`, `useSaveLegacyPlan`, beneficiary mutations, `ValueChart`, `Slider`, `Dialog`, `Select`.

- [ ] **Step 1: Write the failing tests.** `src/screens/legacy/LegacyScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithApp } from '../../test/renderWithApp';

describe('LegacyScreen', () => {
  it('recomputes the projection when a slider moves and refuses an out-of-range scenario inline', async () => {
    renderWithApp({ route: '/legacy', signedIn: true });
    const ending = await screen.findByLabelText('Ending capital');
    const before = ending.textContent;
    const slider = screen.getByRole('slider', { name: 'Monthly contribution' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(ending.textContent).not.toBe(before);
    const horizon = screen.getByRole('slider', { name: 'Horizon' });
    fireEvent.keyDown(horizon, { key: 'End' });
    const rate = screen.getByRole('slider', { name: 'Annual return' });
    fireEvent.keyDown(rate, { key: 'End' });
    const capital = screen.getByRole('slider', { name: 'Starting capital' });
    fireEvent.keyDown(capital, { key: 'End' });
    expect(await screen.findByText('This scenario exceeds the supported range. Reduce the amount, rate or horizon.')).toBeInTheDocument();
  });
});
```

`tests/e2e/legacy.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('legacy sliders redraw the projection, save a version and keep shares within 100%', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.goto('/legacy');
  const ending = page.getByLabel('Ending capital');
  const before = await ending.textContent();
  await page.getByRole('slider', { name: 'Monthly contribution' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(ending).not.toHaveText(before!);
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Add beneficiary' }).click();
  await page.getByLabel('Full name').fill('Too Much');
  await page.getByLabel('Share %').fill('50');
  await page.getByRole('button', { name: 'Save beneficiary' }).click();
  await expect(page.getByText(/exceed 100/)).toBeVisible();
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm test -- src/screens/legacy`. Expected: FAIL.

- [ ] **Step 3: Implement** per the spec's Legacy row, porting the Plan B page and components: sliders (`aria-label`s "Monthly contribution", "Annual return", "Annual fee", "Inflation", "Horizon", "Draw rate", "Starting capital"), projection recomputed synchronously with `legacyPlanModel.project` on every change (and `previewLegacyPlan` debounced 400 ms in live mode), `aria-label="Ending capital"` on the figure, out-of-range → the model's message in place of the chart; "Save version" → `useSaveLegacyPlan({ expectedRevision, plan })`, a 409 → "This plan changed elsewhere. Reload to see the latest version."; beneficiaries list with share bars and remainder, add/edit dialog (name, relationship `Select`, share %, optional date of birth), remove with confirm, `share_exceeds_100` mapped onto the share field ("Shares can't exceed 100%").

- [ ] **Step 4: Run the tests.** `npm test -- src/screens/legacy`, then `npm run build && npx playwright test tests/e2e/legacy.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit and open the pull request** (`task/13-legacy`, `feat: Legacy Studio with live projection and beneficiaries`), review, ask to merge.

### Task 14: Profile — verification, security, support, preferences, closure

**Files:**
- Create: `src/lib/imageCapture.ts`, `src/lib/imageCapture.spec.ts`, `src/screens/profile/ProfileScreen.tsx`, `src/screens/verification/VerificationScreen.tsx`, `src/screens/security/SecurityScreen.tsx`, `src/screens/security/SecurityScreen.test.tsx`, `src/screens/support/SupportScreen.tsx`, `src/screens/ticket/TicketScreen.tsx` (each + css), `tests/e2e/profile.spec.ts`
- Modify: `src/app/router.tsx` (`/profile`, `/profile/verification`, `/profile/security`, `/profile/support`, `/profile/support/:ticketId`), `tests/e2e/move.spec.ts` (un-fixme the transfer test)
- Reference: `.reference/plan-b/mobile/floot-app/pages/profile*.tsx` (+ css), `helpers/{imageCapture,kycGeo,appLock}.tsx`

**Interfaces:**
- Consumes: `useMe`, `useKyc`, `useSessions`, `useTickets`, `useTicket`, the account mutations, `useAppSession` (theme, lockEnabled, signOut, confirm), `platform.notifications`, `InstallButton`, `kycGeo`.
- Produces: `imageCapture(file: File, opts?: { maxEdge?: number; maxBytes?: number }): Promise<string>` (JPEG data URL, longest edge ≤ 1600 px, ≤ 1.6 MB of base64, quality stepping down from 0.9).

- [ ] **Step 1: Write the failing tests.** `src/lib/imageCapture.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { imageCapture } from './imageCapture';

describe('imageCapture', () => {
  it('downscales to the maximum edge and returns a JPEG data URL', async () => {
    const drawn: number[][] = [];
    const ctx = { drawImage: vi.fn((_img: unknown, _x: number, _y: number, w: number, h: number) => { drawn.push([w, h]); }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/4AAQ');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close() {} })));
    const out = await imageCapture(new File(['x'], 'doc.png', { type: 'image/png' }));
    expect(out.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(drawn[0]).toEqual([1600, 1200]);
  });
  it('refuses a non-image', async () => {
    await expect(imageCapture(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))).rejects.toThrow('Choose a photo');
  });
});
```

`src/screens/security/SecurityScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('SecurityScreen', () => {
  it('enrols two-factor and shows the backup codes once', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/profile/security', signedIn: true });
    await user.click(await screen.findByRole('button', { name: 'Turn on two-factor' }));
    await user.type(screen.getByLabelText('Current password'), 'sample');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/otpauth:\/\//)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    expect((await screen.findAllByTestId('backup-code')).length).toBeGreaterThanOrEqual(8);
  });
  it('signs this device out when its own session is revoked', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/profile/security', signedIn: true });
    await user.click(await screen.findByRole('button', { name: /Sign out this device/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
  });
});
```

`tests/e2e/profile.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import path from 'node:path';

test.beforeEach(async ({ page }) => { await page.goto('/sign-in'); await page.getByRole('button', { name: 'Explore with sample data' }).click(); });

test('theme switch applies instantly and persists', async ({ page }) => {
  await page.goto('/profile');
  await page.getByRole('radio', { name: 'Ivory Estate' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ivory');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ivory');
});

test('verification wizard submits with a document photo', async ({ page }) => {
  await page.goto('/profile/verification');
  await page.getByRole('button', { name: 'Start verification' }).click();
  await page.getByLabel('Date of birth').fill('1990-05-04');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Document type').selectOption('passport');
  await page.getByLabel('Document number').fill('X1234567');
  await page.getByLabel('Document photo').setInputFiles(path.join(__dirname, '../fixtures/doc.jpg'));
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Address line 1').fill('1 Orbit Way');
  await page.getByLabel('City').fill('Springfield');
  await page.getByLabel('Postal code').fill('12345');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Employment status').selectOption('employed');
  await page.getByLabel('Source of funds').selectOption('salary');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Under review')).toBeVisible();
});

test('support ticket and reply', async ({ page }) => {
  await page.goto('/profile/support');
  await page.getByRole('button', { name: 'New request' }).click();
  await page.getByLabel('Subject').fill('Statement question');
  await page.getByLabel('Message').fill('Where is my September statement?');
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.getByRole('link', { name: 'Statement question' }).click();
  await page.getByLabel('Reply').fill('Thanks — found it.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Thanks — found it.')).toBeVisible();
});

test('close account is refused while capital is deployed', async ({ page }) => {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Close account' }).click();
  await page.getByLabel('Password').fill('sample');
  await page.getByRole('button', { name: 'Close my account' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('alert')).toContainText(/capital is still deployed/i);
});
```

(`tests/fixtures/doc.jpg`: a 1200×800 JPEG generated once with sharp and committed.)

- [ ] **Step 2: Run them to verify they fail.** `npm test -- src/lib/imageCapture src/screens/security`. Expected: FAIL.

- [ ] **Step 3: Implement** per the spec's Profile rows, porting the Plan B pages: hub (identity header; rows; seven `Switch`es → `useSetNotificationPrefs` — turning any on when `permission() === 'default'` calls `platform.notifications.request()` then subscribes; six theme swatches as a radio group; app lock toggle → `setLockEnabled`; `InstallButton placement="profile"`; legal links from `brand.links`; sign out; close account dialog → `confirm('Close your account')` → `useCloseAccount`, `active_holdings` → `role="alert"` "Your capital is still deployed. Close your positions first."); verification wizard (steps and labels as in the e2e, option lists from `kycGeo`, photos through `imageCapture`, draft in component state only, field errors from `MobileApiError.fields`, "Under review" on success); security (two-factor enrol/enable/disable, transfer PIN set/change with labels "Current password", "New PIN", "Save PIN", password change, sessions with "Sign out this device" on the current row and "Sign out" on others, `current: true` → `signOut()`); support list with "Show older requests" and the new-request dialog (hidden with a note when `features.support` is false); ticket thread with you/support bubbles and the reply box. Un-fixme the transfer e2e in `tests/e2e/move.spec.ts`.

- [ ] **Step 4: Run the tests.** `npm test -- src/lib src/screens`. Expected: PASS. `npm run build && npx playwright test tests/e2e/profile.spec.ts tests/e2e/move.spec.ts`. Expected: passed.

- [ ] **Step 5: Commit and open the pull request** (`task/14-profile`, `feat: Profile, verification wizard, security, support and closure`), review, ask to merge.

### Task 15: Alerts and the Oracle

**Files:**
- Create: `src/lib/alertTarget.ts`, `src/lib/alertTarget.spec.ts`, `src/screens/alerts/AlertsScreen.tsx` (+ css), `src/screens/oracle/OracleScreen.tsx` (+ css), `src/screens/oracle/OracleScreen.test.tsx`, `tests/e2e/alerts-oracle.spec.ts`
- Modify: `src/app/router.tsx` (`/alerts`, `/oracle`), `src/components/HeaderActions.tsx` (badge + links verified)
- Reference: `.reference/plan-b/mobile/floot-app/pages/{alerts,oracle}.tsx` (+ css), `helpers/{alertTarget,alertTarget.spec,sampleOracle}.tsx`

**Interfaces:**
- Produces: `alertTarget(alert: Pick<AlertView, 'category' | 'kind' | 'entityType' | 'entityId'>): string | null` (route to open on tap; `null` = stay on Alerts).

- [ ] **Step 1: Write the failing spec** — `src/lib/alertTarget.spec.ts` (port the reference spec; the cases are):

```ts
import { describe, it, expect } from 'vitest';
import { alertTarget } from './alertTarget';

const a = (category: string, kind = 'generic', entityType: string | null = null, entityId: string | null = null) => ({ category, kind, entityType, entityId }) as Parameters<typeof alertTarget>[0];

describe('alertTarget', () => {
  it('routes money alerts to Move', () => {
    expect(alertTarget(a('deposit', 'deposit_approved'))).toBe('/move/deposit');
    expect(alertTarget(a('deposit', 'transfer_received', 'transfer', 't1'))).toBe('/move/transfer');
    expect(alertTarget(a('withdrawal', 'withdrawal_paid'))).toBe('/move/withdraw');
  });
  it('routes verification, support and security', () => {
    expect(alertTarget(a('kyc', 'kyc_approved'))).toBe('/profile/verification');
    expect(alertTarget(a('support', 'ticket_replied', 'ticket', 'tk9'))).toBe('/profile/support/tk9');
    expect(alertTarget(a('support', 'ticket_closed'))).toBe('/profile/support');
    expect(alertTarget(a('security', 'password_changed'))).toBe('/profile/security');
  });
  it('routes portfolio and account alerts', () => {
    expect(alertTarget(a('system', 'position_matured', 'investment', 'inv2'))).toBe('/move');
    expect(alertTarget(a('system', 'position_opened', 'investment', 'inv2'))).toBe('/portfolio/inv2');
    expect(alertTarget(a('system', 'tier_changed'))).toBe('/profile');
    expect(alertTarget(a('security', 'beneficiary_updated', 'beneficiary', 'b1'))).toBe('/legacy');
  });
  it('stays on Alerts for referrals and unknown kinds', () => {
    expect(alertTarget(a('referral', 'referral_bonus'))).toBeNull();
    expect(alertTarget(a('system', 'mystery'))).toBeNull();
  });
});
```

`src/screens/oracle/OracleScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('OracleScreen', () => {
  it('answers a suggested question from the sample world and keeps a failed question in the input', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/oracle', signedIn: true });
    const suggestion = (await screen.findAllByRole('button', { name: /\?$/ }))[0]!;
    await user.click(suggestion);
    expect(await screen.findByRole('article')).toHaveTextContent(/\$[\d,]+/);
    expect(screen.getByText(/not financial advice/i)).toBeInTheDocument();
  });
});
```

`tests/e2e/alerts-oracle.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/sign-in'); await page.getByRole('button', { name: 'Explore with sample data' }).click(); });

test('alerts mark read on tap and open the related screen', async ({ page }) => {
  const badge = page.getByRole('link', { name: /Alerts, \d+ unread/ });
  await expect(badge).toBeVisible();
  await badge.click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const first = page.getByRole('listitem').filter({ has: page.getByText('Unread') }).first();
  const title = await first.getByRole('heading').textContent();
  await first.click();
  await expect(page).not.toHaveURL(/\/alerts$/);
  await page.goto('/alerts');
  await expect(page.getByRole('listitem').filter({ hasText: title! })).not.toContainText('Unread');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('link', { name: /Alerts, 0 unread/ })).toBeVisible();
});

test('alerts?open= opens a notification by id', async ({ page }) => {
  await page.goto('/alerts');
  const id = await page.getByRole('listitem').first().getAttribute('data-id');
  await page.goto(`/alerts?open=${id}`);
  await expect(page).not.toHaveURL(/open=/);
});

test('oracle answers a suggested question', async ({ page }) => {
  await page.goto('/oracle');
  await page.getByRole('button', { name: /\?$/ }).first().click();
  await expect(page.getByRole('article').first()).toContainText('$');
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm test -- src/lib/alertTarget src/screens/oracle`. Expected: FAIL.

- [ ] **Step 3: Implement.** `alertTarget.ts` per the spec cases (port the reference). Alerts screen: Today / Earlier groups (`<h2>`), `<li data-id>` items with category icon, title (`<h3>`), body, amount via `Amount`, relative time, an "Unread" visually-hidden-but-queryable label (`<span class="srOnly">Unread</span>`) and the dot; tap → `useMarkRead(id)` then `navigate(alertTarget(alert) ?? '/alerts')`; `?open=<id>` → mark read and navigate to the target (strip the param when the id is unknown); "Mark all read" → `useMarkRead()`; `HeaderActions` bell is `<Link aria-label={\`Alerts, ${unread} unread\`}>`. Oracle: full-screen conversation, `ORACLE_SUGGESTIONS` as buttons, typing indicator, answers as `<article>` with model and source count, `feature_disabled` / `rate_limited` (with the retry-after seconds) / `oracle_unavailable` as calm inline notices, a failed question restored into the input.

- [ ] **Step 4: Run the tests.** `npm test -- src/lib src/screens`. Expected: PASS. `npm run build && npx playwright test tests/e2e/alerts-oracle.spec.ts`. Expected: passed.

- [ ] **Step 5: Commit and open the pull request** (`task/15-alerts-oracle`, `feat: Alerts with deep links and the Oracle conversation`), review, ask to merge.

### Task 16: Wide layout — navigation rail, content column, split panes, keyboard navigation

**Files:**
- Create: `src/components/NavRail.tsx` (full version; + css), `src/components/SplitPane.tsx` (+ css), `src/components/SplitPane.test.tsx`, `tests/e2e/wide.spec.ts`
- Modify: `src/components/AppShell.tsx` (+ css), `src/screens/portfolio/PortfolioScreen.tsx`, `src/screens/support/SupportScreen.tsx`, `src/screens/invest/InvestScreen.tsx`, `src/app/router.tsx` (detail routes render inside the list screen's pane at 900 px+), `tests/e2e/home.spec.ts` (the Main navigation link count becomes `(page.viewportSize()?.width ?? 0) >= 900 ? 7 : 5`)

**Interfaces:**
- Consumes: `useLayout()`.
- Produces: `SplitPane({ list: ReactNode; detail: ReactNode | null; detailTitle?: string })` — below 900 px renders only `list` (detail routes are separate screens); at 900 px+ renders both side by side with the detail in a `<section aria-label={detailTitle}>` and an empty-state placeholder when `detail` is null. `NavRail` = `<nav aria-label="Main">` with Home · Portfolio · Move · Legacy · Profile · Alerts · Oracle, `aria-current="page"` on the active link.

- [ ] **Step 1: Write the failing tests.** `src/components/SplitPane.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const layout = vi.hoisted(() => ({ value: 'phone' as 'phone' | 'wide' }));
vi.mock('../design/useLayout', () => ({ useLayout: () => layout.value }));
import { SplitPane } from './SplitPane';

describe('SplitPane', () => {
  it('renders only the list on phones', () => {
    layout.value = 'phone';
    render(<SplitPane list={<p>list</p>} detail={<p>detail</p>} detailTitle="Holding" />);
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.queryByText('detail')).toBeNull();
  });
  it('renders both panes on wide screens with a placeholder when nothing is selected', () => {
    layout.value = 'wide';
    const { rerender } = render(<SplitPane list={<p>list</p>} detail={null} detailTitle="Holding" />);
    expect(screen.getByRole('region', { name: 'Holding' })).toHaveTextContent('Select an item');
    rerender(<SplitPane list={<p>list</p>} detail={<p>detail</p>} detailTitle="Holding" />);
    expect(screen.getByText('detail')).toBeInTheDocument();
  });
});
```

`tests/e2e/wide.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('wide layout', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, 'desktop project only');

  test('uses a navigation rail and side-by-side panes', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Explore with sample data' }).click();
    const rail = page.getByRole('navigation', { name: 'Main' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link')).toHaveCount(7);
    await rail.getByRole('link', { name: 'Portfolio' }).click();
    await expect(page.getByRole('region', { name: 'Holding' })).toContainText('Select an item');
    await page.getByRole('link', { name: /Real Estate/ }).click();
    await expect(page).toHaveURL(/\/portfolio\//);
    await expect(page.getByRole('region', { name: 'Holding' })).toContainText('Progress to maturity');
    const box = await page.locator('main').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1280);
  });

  test('is fully keyboard navigable', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Explore with sample data' }).click();
    await page.keyboard.press('Tab');
    for (let i = 0; i < 12; i++) {
      const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() }));
      expect(focused.tag, `tab stop ${i}`).toBeTruthy();
      if (focused.name === 'Legacy') { await page.keyboard.press('Enter'); break; }
      await page.keyboard.press('Tab');
    }
    await expect(page).toHaveURL('/legacy');
    await expect(page.locator(':focus-visible')).toHaveCount(0); // focus moved to the new screen's heading without a visible ring on body
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm test -- src/components/SplitPane`. Expected: FAIL.

- [ ] **Step 3: Implement.** `AppShell` renders `NavRail` + a centred `<main>` (max-width 720 px, or 1280 px when a split pane is on) at 900 px+ and `TabBar` below; `SplitPane` as the interface; Portfolio (holdings ↔ holding, statements ↔ statement), Support (tickets ↔ thread) and Invest (strategies ↔ invest sheet) use it; the detail routes stay valid URLs in both layouts; on route change focus moves to the screen's `<h1>` (`tabIndex={-1}`, no visible ring); visible focus rings on every interactive element (`:focus-visible` outline using `--accent-text`).

- [ ] **Step 4: Run the tests.** `npm test -- src/components`, then `npm run build && npx playwright test tests/e2e/wide.spec.ts --project=desktop-chromium`, and the whole e2e suite on all projects to catch regressions. Expected: PASS.

- [ ] **Step 5: Commit and open the pull request** (`task/16-wide-layout`, `feat: navigation rail, content column and split panes at 900px+`), review, ask to merge.

### Task 17: Audits — overflow, contrast, accessibility, reduced motion; fix every finding

**Files:**
- Create: `tests/audits/routes.ts`, `tests/audits/overflow.spec.ts`, `tests/audits/contrast.spec.ts`, `tests/audits/axe.spec.ts`, `tests/audits/motion.spec.ts`, `tests/audits/screenshots.spec.ts`
- Modify: `src/session/AppSession.tsx` (`enterSample` honours `?sampleStress=1` and `?sampleLatency=<ms>`), `playwright.config.ts` (projects `audit-320` at 320×568 and `audit-393` at 393×852, both Chromium, `testDir` includes `tests/audits`)
- Reference: `.reference/plan-b/.superpowers/sdd/2026-10-01-mobile-app-plan-b/harness/audits/{layout.ts,contrast.ts,flows.ts}`

**Interfaces:**
- Produces: `ROUTES: string[]` — every route of the app, with ids discovered at runtime (`/portfolio/<first holding>`, `/statements/2026-09`, `/profile/support/<first ticket>`); `visibleTextContrast(page)` helper returning `{ selector, text, ratio, fg, bg }[]` for every visible text node (composited background walks up through transparent ancestors; `large` = ≥ 24 px or ≥ 18.66 px bold).

- [ ] **Step 1: Write the failing audits.** `tests/audits/overflow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ROUTES, signInSample } from './routes';

test.describe('overflow at 320×568 with stress data', () => {
  test.skip(({ viewport }) => viewport?.width !== 320);
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await signInSample(page, { stress: true });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const findings = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page scrolls horizontally: ${document.documentElement.scrollWidth}px`);
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-amount], h1, h2, h3, button, a, label'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > window.innerWidth + 1) out.push(`past right edge: ${el.tagName} "${el.textContent?.trim().slice(0, 30)}"`);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') out.push(`clipped text: ${el.tagName} "${el.textContent?.trim().slice(0, 30)}"`);
        }
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=button], [role=switch], [role=tab], input, select, textarea'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 44 || r.height < 44) out.push(`target under 44px: ${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent)?.trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
          const name = el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? el.textContent?.trim() ?? (el as HTMLInputElement).labels?.[0]?.textContent;
          if (!name) out.push(`unnamed control: ${el.outerHTML.slice(0, 60)}`);
        }
        for (const img of Array.from(document.images)) if (!img.alt && img.getAttribute('role') !== 'presentation') out.push(`image without alt: ${img.src.slice(0, 40)}`);
        return out;
      });
      expect(findings, findings.join('\n')).toEqual([]);
    });
  }
});
```

`tests/audits/contrast.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ROUTES, signInSample, visibleTextContrast } from './routes';

const THEMES = ['orbital', 'obsidian', 'ivory', 'aurora', 'verdant', 'aegis'];

test.describe('contrast at 393×852 in every theme', () => {
  test.skip(({ viewport }) => viewport?.width !== 393);
  for (const theme of THEMES) for (const route of ROUTES) {
    test(`${theme} ${route}`, async ({ page }) => {
      await signInSample(page);
      await page.evaluate((t) => localStorage.setItem('app.theme', t), theme);
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const failing = (await visibleTextContrast(page)).filter((n) => n.ratio < (n.large ? 3 : 4.5));
      expect(failing, failing.map((f) => `${f.selector} "${f.text}" ${f.ratio.toFixed(2)} ${f.fg} on ${f.bg}`).join('\n')).toEqual([]);
    });
  }
});
```

`tests/audits/axe.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES, signInSample } from './routes';

test.describe('axe', () => {
  test.skip(({ viewport }) => viewport?.width !== 393);
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await signInSample(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')).toEqual([]);
    });
  }
});
```

`tests/audits/motion.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signInSample } from './routes';

test('reduced motion renders final values immediately and a still starfield', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInSample(page);
  await page.goto('/');
  const first = await page.locator('[data-amount]').first().textContent();
  expect(first).toMatch(/^\$[\d,]+\.\d{2}$/);
  const frameA = await page.locator('canvas[data-starfield]').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(600);
  const frameB = await page.locator('canvas[data-starfield]').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(frameA).toBe(frameB);
});
```

`tests/audits/screenshots.spec.ts`: signs in, visits every route in Orbital and Ivory Estate at 393×852 and saves `test-results/screens/<theme>/<route>.png` (uploaded as a CI artifact; not asserted).

- [ ] **Step 2: Run the audits and collect findings.** `npm run build && npx playwright test tests/audits --project=audit-320 --project=audit-393`. Expected on first run: failures listing concrete findings.

- [ ] **Step 3: Fix every finding** in the components and screens that own them (never by relaxing the audit): compact money in tight rows, `overflow-wrap: anywhere` on names, minimum 44 px hit areas via padding, `aria-label`s on icon-only buttons, `alt` text, colour nudges through `themes.ts` (keeping its specs green), focus order.

- [ ] **Step 4: Re-run until green.** Audits: 0 findings on every route in every theme; `npm run verify` and the full `npm run test:e2e` green.

- [ ] **Step 5: Commit and open the pull request** (`task/17-audits`, `test: overflow, contrast, axe and reduced-motion audits; fix findings`), review, ask to merge.

### Task 18: CI, hosting, repo bot and documentation

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/claude.yml`, `.github/workflows/claude-review.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `docs/HOSTING.md`, `docs/REPO_BOT.md`, `CHANGELOG.md`
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: CI workflow** — `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run apply-company
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --coverage
      - run: npm run build
      - run: npm run audit:deps
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist, retention-days: 7 }
  e2e:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium webkit
      - run: npm run build
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: screens, path: test-results/screens, retention-days: 7 }
  lighthouse:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npm run lhci
```

- [ ] **Step 2: Repo bot workflows** — `.github/workflows/claude.yml`:

```yaml
name: Claude Code
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
  issues: { types: [opened] }
jobs:
  claude:
    if: contains(github.event.comment.body || github.event.issue.body, '@claude')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write, id-token: write, actions: read }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 1 }
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: '--max-turns 30'
```

`.github/workflows/claude-review.yml`:

```yaml
name: Claude Review
on:
  pull_request: { types: [opened, synchronize, ready_for_review, reopened] }
jobs:
  review:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: read, issues: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 1 }
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          plugin_marketplaces: "https://github.com/anthropics/claude-code.git"
          plugins: "code-review@claude-code-plugins"
          prompt: "/code-review:code-review --comment ${{ github.repository }}/pull/${{ github.event.pull_request.number }}"
          claude_args: '--allowedTools "mcp__github_inline_comment__create_inline_comment"'
```

`.github/dependabot.yml`: npm weekly, grouped minor/patch updates, plus `github-actions` weekly. `docs/REPO_BOT.md` — owner steps: (1) install the Claude GitHub App on the repo (github.com/apps/claude); (2) on a machine with Claude Code, run `claude setup-token` and add the printed token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` (Settings → Secrets and variables → Actions); (3) merge this PR; (4) test with a comment `@claude summarise this repo`. A company may swap the secret for `ANTHROPIC_API_KEY` and the `anthropic_api_key` input.

- [ ] **Step 3: Hosting docs** — `docs/HOSTING.md`: Cloudflare Pages (Workers & Pages → Create → connect the GitHub repo → build command `npm run build`, output `dist`, Node 22 via `NODE_VERSION=22`, production branch `main`, preview deployments on pull requests; custom domain; `_headers` is honoured); Vercel alternative (import the repo; framework Vite; output `dist`; `vercel.json` is honoured; Hobby is non-commercial — previews only). `README.md` final: what it is, screenshots, sample vs live, requirements, `npm run dev/verify/test:e2e/build`, the per-company checklist (copy `company.config.json` edits, icon, platform origin in `MOBILE_APP_ORIGINS`, hosting, release — forward reference to sub-project 2), security model (tokens, lock, CSP) stated honestly, the sub-project map. `CLAUDE.md` final (rules, commands, layout, "never fetch from screens", "money in cents", "tests first", review tools). `.github/pull_request_template.md` with a verification-output section. `CHANGELOG.md` starts at `0.1.0 — sub-project 1`.

- [ ] **Step 4: Verify the workflows locally where possible.** `npx action-validator .github/workflows/*.yml` (install `action-validator` as a devDependency) → exit 0; `npm run verify`; then push the branch and confirm all three CI jobs pass on the pull request (the Claude workflows run once the owner adds the secret).

- [ ] **Step 5: Commit and open the pull request** (`task/18-ci-hosting-bot`, `ci: pipeline, repo bot workflows, Dependabot, hosting and bot docs`), review, ask to merge. Then ask the owner to enable branch protection on `main` (require the `verify`, `e2e` and `lighthouse` checks).

### Task 19: Template release and the sub-project gate

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-10-01-investor-app-core-design.md` (status line), `README.md` (preview link)

- [ ] **Step 1: Owner connects hosting.** The owner imports the repo into Cloudflare Pages per `docs/HOSTING.md` (or Vercel for a personal preview) and shares the preview URL.

- [ ] **Step 2: Verify the deployed template.** Against the live URL: `curl -sI <url>/manifest.webmanifest | grep -i content-type` → `application/manifest+json`; `curl -sI <url>/ | grep -i content-security-policy` → the CSP from `_headers`; `npx playwright test tests/e2e/pwa.spec.ts --project=phone-chromium` with `PLAYWRIGHT_BASE_URL=<url>` (add `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173'` and skip `webServer` when set) → passed; install the app on one Android phone, one iPhone and one laptop browser and record the three results in `CHANGELOG.md`.

- [ ] **Step 3: Full gate, with output.** Run and paste into the release PR: `npm run verify`, `npm run test:e2e` (all projects, including audits), `npm run lhci`, `npm run audit:deps`. Every spec, test and audit green; coverage summary attached.

- [ ] **Step 4: Spec success criteria checklist.** Walk the six criteria in spec §1 and the screen table in §8; tick each with the test or screenshot that proves it; any gap becomes a task in this plan before release.

- [ ] **Step 5: Release.** Update the spec status to "built — sub-project 1 released", add the preview link to the README, `CHANGELOG.md 0.1.0`, tag `v0.1.0` on `main`, open the branch for sub-project 2 planning (its spec starts from `docs/superpowers/specs/` the same way). Commit `chore: release 0.1.0 — investor app core on sample data`.
