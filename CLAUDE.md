# CLAUDE.md

Rules for every engineer and bot that works in this repository. Read them before you change
anything, and keep to them in every task.

## What this is

The investor app: a white-label, installable web app (PWA) built with Vite, React 19 and strict
TypeScript. It has no backend of its own. Screens read through TanStack Query hooks into one
`PlatformApi` interface, which has two implementations: `createSampleApi` (an in-memory sample
world) and `createLiveApi` (an HTTPS client for a company's platform, under `/api/mobile/v1`).

This is a public template. A company that deploys it changes `company.config.json` and
`branding/icon.png` and nothing else.

The design is in `docs/superpowers/specs/2026-10-01-investor-app-core-design.md` and the build plan
is in `docs/superpowers/plans/2026-10-01-investor-app-core.md`. `docs/BUILD_ENVIRONMENT.md` describes
how the maintainers install, build and push; it is operational notes, not product rules.

## Commands

Run everything from the repository root.

- `npm run verify` runs typecheck, lint, tests and build, in that order. Run it before you say
  anything is done, and show its output. A change is not done until it passes.
- `npm run test:e2e` runs the Playwright tests on three projects: `phone-chromium`, `phone-webkit`
  and `desktop-chromium`. It tests the built app (Playwright starts `npm run preview`, which serves
  `dist/`), so run `npm run build` first. Install the browsers once with
  `npx playwright install chromium webkit`, and use `--project=<name>` to run a subset.
- `npm run apply-company` turns `company.config.json` and `branding/icon.png` into everything derived
  from them: the web manifest, icons, hosting headers, environment file and the `index.html` meta
  tags. It runs automatically at the start of `npm run build`.
- `npm run dev` starts the Vite dev server. `npm run preview` serves the built app on port 4173.
- `npm test` runs the unit and component tests once; `npm run test:watch` keeps them running.
- `npm run typecheck`, `npm run lint` (zero warnings allowed) and `npm run format` (Prettier) do what
  they say.
- `npm run icons` regenerates the icon set, `npm run screenshots` captures the manifest screenshots
  from the sample app, `npm run lhci` runs the Lighthouse installability check and
  `npm run audit:deps` fails on high-severity dependency advisories.

## Rules

### Process

- Tests come before code. Write the failing test, watch it fail for the reason you expect, then
  write the smallest code that passes. Every helper with logic has a spec next to it.
- One branch per task, named `task/NN-name`. Make small commits with conventional messages
  (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), each ending with the session trailer that your Claude
  session supplies (the `Co-Authored-By` and `Claude-Session` lines).
- Every task gets a pull request. Review it with `pr-review-toolkit:review-pr` and
  `security-guidance` before the owner merges. Use `superpowers:verification-before-completion`
  before any claim of "done".
- Before you use a library for the first time in a task, confirm its current API against the
  installed package's `README.md` and type declarations in `node_modules`.
- One responsibility per file. Follow the layout below.

### Platform and data

- Sign-in is the platform's own sign-in, through `/api/mobile/v1`, and nothing else.
- Every request carries `X-App-Version` (the `package.json` version), `X-App-Platform: web` and
  `X-Device-Id` (random per install, 8 to 128 characters from `A-Z a-z 0-9 _ -`). It may carry
  `X-Device-Name` (percent-encoded UTF-8). Signed-in routes also send `Authorization: Bearer <accessToken>`.
- Errors arrive as `{ error, message?, fields?, ...details }`. Every API failure becomes a
  `MobileApiError`. Screens show its `message`, map its `fields` onto form fields, and never show a
  raw error code.
- Money is integer cents plus a currency code. Figures with `basis: 'projection'` are shown as
  projections, never as market performance.
- Screens never call `fetch`. They use the hooks in `src/queries`. ESLint enforces this
  (`no-restricted-globals`), with exceptions only for `src/api/createLiveApi.ts`, `src/platform/**`,
  `scripts/**` and `tests/**`.
- Offline, the app shows a banner, renders money figures as "•••" and disables mutations.

### White-label

- Nothing company-specific lives outside `company.config.json`, `branding/icon.png` and generated
  files. The runtime identity (name, tagline, accent, logo, default theme, features, links, support)
  always comes from `GET /brand`.
- Sample mode is on when `platformUrl` is `""`. Every screen then shows a visible "Sample" ribbon,
  any email signs in, and an email containing `+2fa` takes the two-factor step with the code
  `123456`.

### Privacy and security

- No investor data persists beyond the session. The query cache and the access token live in memory;
  the refresh token is encrypted in IndexedDB; `localStorage` holds only `app.theme`,
  `app.lockEnabled` and the public brand; the KYC draft and its images stay in component state.
- Every money action and every account closure first runs `useAppSession().confirm(reason)`.
- The app locks after 5 minutes hidden (unless `app.lockEnabled` is false), on launch when a session
  is stored, and on "Lock now".
- Fonts are self-hosted through the `@fontsource` packages (Instrument Serif, Inter Tight, JetBrains
  Mono). There are no third-party scripts, fonts, analytics or CDNs. The content security policy is:

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' <platformUrl>; frame-src <platformUrl>; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

- Free tiers only: a public GitHub repository, Cloudflare Pages (free), Vercel Hobby for personal
  previews only (it is non-commercial), and the owner's Claude subscription for the repo bot. No
  paid service and no code signing.

### Look and feel

- Six themes: `orbital`, `obsidian`, `ivory`, `aurora`, `verdant` and `aegis`. Any company accent is
  made readable on each theme: accent text at least 4.5:1 on the background, card and surface;
  primary at least 3:1 on the background; primary foreground pure `#000000` or `#FFFFFF`.
- WCAG AA everywhere. Honour reduced motion. Touch targets are at least 44 px. Type sizes are in
  `rem`. Every control has a label, and everything works from the keyboard.
- Phones (below 900 px) get the tabs Home, Portfolio, Move (the centre orb), Legacy and Profile. At
  900 px and above the app uses a navigation rail, a content column (720 px at most) and split
  panes. The routes and screens are the same.
- Copy is plain, warm and short. No exclamation marks, no jargon, and no promises about returns.

### Code style

- TypeScript is strict, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `noImplicitOverride`. Import types with `import type`, and avoid `enum` and constructor parameter
  properties (`erasableSyntaxOnly`).
- Vitest runs with `globals: false`: import `describe`, `it`, `expect` and `vi` from `vitest`. Testing
  Library unmounts after each test (registered in `vitest.setup.ts`).
- Prettier (`.prettierrc`) formats the code; ESLint (flat config, type-aware) must report zero
  warnings.

## File layout

This is the intended structure. Follow it when you add files.

```
company.config.json              per-company identity
branding/icon.png                1024×1024 source icon; the template ships a neutral one
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
