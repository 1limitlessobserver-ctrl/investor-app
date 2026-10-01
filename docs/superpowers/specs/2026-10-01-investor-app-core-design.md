# Investor App — core (sub-project 1) — design

Date: 2026-10-01 · Status: **design approved in conversation, spec awaiting owner review**
Program: **MOBILE-02 — installable investor app** (supersedes MOBILE-01's Floot delivery;
reuses MOBILE-01 Plan A, the platform's mobile API, unchanged)
Repo: `investor-app` (new, public template) · Platform: `marketos-platform` (Everest Reserve)

## 1. Goal

An investor opens the company's website, installs the company's app — on a phone as a
home-screen app, in a browser as an installed app, on a computer as a downloaded desktop
app — signs in with the account they already have, and gets the platform's investor
experience: portfolio, activity and statements, alerts and support, money movement and
identity verification, Legacy Studio and the Oracle. Every number comes from the platform;
every rule is the platform's rule.

The app is a **white-label template**: one public repository that any company deploying the
platform copies, points at its own platform and publishes under its own name, icon and
colours. Nothing company-specific lives in the code.

This spec covers **sub-project 1, the app core**: the installable web app (PWA) running on
clearly labelled sample data, with every screen, the design system, tests, continuous
integration, hosting and the repository bot. Sub-projects 2–4 (desktop installers, platform
integration, going live on free tiers) each get their own spec; section 3 fixes what they
need from this one.

### Success criteria (sub-project 1)

1. On an Android phone, an iPhone (Safari → Add to Home Screen) and a laptop browser, the
   app installs from its own address, opens full-screen with the company icon and name, and
   its shell loads with no network.
2. In sample mode every screen of section 8 works end to end: sign-in (with and without the
   two-factor step), Home, Portfolio with holding and statement detail, Move with deposit,
   withdraw, transfer, invest and maturity choices, Legacy Studio, Profile with
   verification, security, support and closure, Alerts, Oracle — each with designed loading,
   empty, error and offline states, and a device confirmation before every money action.
3. Switching between the six themes keeps WCAG AA contrast with any company accent colour,
   proven by tests, not by eye.
4. The live client passes its specification against a scripted platform: bearer headers,
   one shared refresh, one retry, revoked sessions, outdated-app response, field errors,
   offline — the contract in the platform's `docs/MOBILE_API.md`.
5. Every pull request runs typecheck, lint, unit, component and end-to-end tests, the
   overflow and contrast audits and the installability check, on free GitHub Actions
   minutes; every push to `main` deploys the template preview; `@claude` answers on issues
   and pull requests and reviews every pull request, on the owner's existing subscription.
6. A second company is set up from the template by changing `company.config.json` and one
   icon file, nothing else (verified by a test that builds the app for a fictitious company).

## 2. Decisions made with the owner (2026-10-01)

| Question | Decision |
| --- | --- |
| Which app | The white-label investor client designed in MOBILE-01, delivered as an installable PWA plus a desktop app, talking to each company's platform through the Plan A mobile API. |
| Accounts | **Platform sign-in only**: the website's email, password and two-factor code via `/api/mobile/v1`. No Supabase accounts; no second identity. |
| Phones | **PWA now**, app stores later if ever (Apple's developer programme is paid; the Floot project is abandoned). |
| Download from the site | Yes: Install button for the PWA, Download buttons for Mac (Apple Silicon and Intel), Windows and Linux, phone QR — on the company's website, pointing at that company's own copy (sub-projects 2 and 3). |
| Architecture | **Approach A**: one static client, no app backend; the platform does all server work, including push. Supabase deferred to sub-project 4 (platform hosting). |
| Stack | Vite + React 19 + TypeScript, react-router, TanStack Query, `vite-plugin-pwa`; CSS variables + CSS Modules; Vitest, Playwright. Not Next.js static export (dynamic routes, slower builds, no server features needed). |
| Repo | **Public template** `investor-app`, MIT. Unlimited Actions minutes; "Use this template" for companies; nothing secret in it. |
| Hosting | "Best free tool": **Cloudflare Pages** as the primary host for the template preview and for each company (free, commercial use permitted); **Vercel Hobby** config kept as an alternative for personal previews only (its fair-use terms are non-commercial). |
| Device lock | The OS's own prompt through WebAuthn (Face ID, Touch ID, Windows Hello, Android biometrics); local six-digit passcode where the webview has no authenticator. |
| Process | Tests before code; one branch per task; small commits; pull requests reviewed with pr-review-toolkit and security-guidance before the owner merges; verification output shown before any "done". |

## 3. Program decomposition

| Sub-project | Delivers | Needs from sub-project 1 |
| --- | --- | --- |
| **1 — App core** (this spec) | The PWA on sample data; design system; every screen; live client; tests; CI; hosting; repo bot; docs. | — |
| **2 — Desktop + releases** | `src-tauri/` (Tauri 2), installers for macOS (Intel + Apple Silicon), Windows and Linux built on every push to `release` and published to GitHub Releases under fixed asset names, self-update from those releases, unsigned-app notes, build smoke test. | The `src/platform` adapter boundary (storage, lock, notifications, share, install) with a desktop implementation slot; `scripts/apply-company` writing `src-tauri/tauri.conf.json`. |
| **3 — Platform integration** | Merge `mobile-01-plan-a` into `master`; `MOBILE_APP_ORIGINS`; `POST /push/subscribe` + `/push/unsubscribe` and Web Push sending (`web-push`, VAPID) in the platform's `notify()`; `vapidPublicKey` in `GET /brand`; the website's "Get the app" section with Install, Download and QR; admin settings; live-mode end-to-end test against a local platform. | The live client already typed and tested for the contract in section 11, including `pushSubscribe`/`pushUnsubscribe`. |
| **4 — Go live free** | The platform at a public HTTPS address on free tiers whose terms allow commercial use (host chosen in that spec after a serverless audit; Supabase Postgres and Supabase Cron for the scheduled endpoints, with the keep-alive job), then Everest Reserve wired end to end as company one. | Nothing beyond a published template. |

Each sub-project: spec → plan → test-driven build → pull requests → review → verification.

## 4. Constraints

- **Free tiers only.** GitHub (public repo: unlimited Actions minutes on standard runners),
  Cloudflare Pages free plan (500 builds a month, unlimited bandwidth, previews per branch),
  Vercel Hobby (non-commercial), the owner's Claude subscription for the repo bot. No code
  signing certificates (sub-project 2 documents the unsigned-app steps).
- **Platform contract.** `docs/MOBILE_API.md` in the platform repo (Plan A, branch
  `mobile-01-plan-a`): base path `/api/mobile/v1`, bearer tokens only, `X-App-Version`,
  `X-App-Platform` (`web` for this app; `ios`/`android` are reserved for native builds),
  `X-Device-Id`, `X-Device-Name`; error envelope `{ error, message?, fields?, ... }`;
  money in integer cents with a currency code; projections labelled `basis: 'projection'`.
  The platform is **not yet live**; sub-project 1 needs nothing live.
- **PWA facts.** iPhone push alerts need iOS 16.4+ and the app on the Home Screen; Safari
  has no `beforeinstallprompt` (hence the hint). Chrome and Edge show the install prompt on
  Android, Windows, macOS, Linux and ChromeOS. Lighthouse removed its PWA category in
  version 12, so installability is checked with Chrome's own `Page.getInstallabilityErrors`
  through Playwright, plus Lighthouse 11 (the last with `installable-manifest`) in CI.
- **WebAuthn availability.** Platform authenticators exist in Safari (iOS, macOS), Chrome
  and Edge; Windows WebView2 supports them (Windows Hello); macOS WKWebView does not — the
  desktop app on macOS uses the passcode fallback until a native plugin is added.
- **Privacy.** No analytics, no third-party scripts or fonts, no investor data on any
  server but the company's platform. Nothing investor-specific persists on the device
  beyond the session (section 6).
- **Accessibility.** WCAG AA in every theme; reduced motion honoured; 44 px targets; text
  scales with the system setting; every control labelled; full keyboard navigation.

## 5. Architecture

### Repository layout

```
company.config.json          the ONLY per-company file (section 7)
branding/icon.png            the company icon source (1024×1024); template ships a neutral one
public/                      generated icons, manifest, fonts, _headers (Cloudflare), robots
src/
  main.tsx, app/             router, providers, AppShell/FlowShell routing, lazy routes
  api/                       types.ts (mirror of MOBILE_API.md), PlatformApi.ts,
                             MobileApiError.ts, createLiveApi.ts, createSampleApi.ts
  session/                   AppSession.tsx (provider + useAppSession), tokens.ts, brand.ts
  queries/                   TanStack Query hooks and mutations
  design/                    themes.ts, tokens.css (base), motion.ts, contrast.ts
  components/                Panel, AppShell, FlowShell, NavRail, TabBar, HeaderActions,
                             Starfield, SpaceBackdrop, BrandMark, CountUp, Amount, AmountField,
                             OrbitalRing, ValueChart, StateView, StatusBanners, UpdateRequired,
                             LockScreen, ConfirmSheet, form primitives (Radix-based)
  screens/                   home, portfolio, holding, statement, move, deposit, withdraw,
                             transfer, invest, legacy, profile, verification, security,
                             support, ticket, alerts, oracle, signIn, lock
  platform/                  adapters: storage, lock, notifications, share, install, haptics,
                             each with web/ and (sub-project 2) desktop/ implementations
  sample/                    sampleData.ts, portfolioMath.ts, sampleStatements.ts,
                             sampleOracle.ts, kycGeo.ts
  lib/                       format.ts, legacyPlanModel.ts, statementPdf.ts, imageCapture.ts,
                             alertTarget.ts, version.ts
scripts/                     apply-company.ts, generate-icons.ts, verify.ts
tests/                       Playwright end-to-end, audits (overflow, contrast), fixtures
.github/workflows/           ci.yml, claude.yml, claude-review.yml, dependabot.yml
docs/                        superpowers/specs, superpowers/plans, STORE_REVIEW.md (later)
```

Rules: one responsibility per file; screens never call `fetch`; nothing company-specific
outside `company.config.json`, `branding/` and generated files; every helper with logic has
a spec next to it.

### Units and interfaces

- `PlatformApi` (`src/api/PlatformApi.ts`): one method per route of `MOBILE_API.md` —
  `login, loginTwoFactor, refresh, logout, brand, me, setNotificationPrefs, changePassword,
  setPin, sessions, revokeSession, enrollTwoFactor, enableTwoFactor, disableTwoFactor,
  closeAccount, dashboard, investments, investment, strategies, history, statements,
  statement, statementCsv, notifications, markRead, pushSubscribe, pushUnsubscribe,
  supportTickets, openTicket, ticket, replyTicket, depositMethods,
  manualDeposit, cardDeposit, withdrawals, requestWithdrawal, transfers, sendTransfer,
  invest, maturityChoice, kyc, submitKyc, legacyPlan, saveLegacyPlan, previewLegacyPlan,
  beneficiaries, addBeneficiary, updateBeneficiary, removeBeneficiary, oracleAsk` plus
  `mode: 'sample' | 'live'`. Field names copy the Plan A handlers exactly. Plan A's
  `POST /push/ticket` (the Floot relay ticket) stays on the platform but is not part of
  this interface; Web Push replaces the relay (section 11).
- `createLiveApi({ baseUrl, tokenStore, app: { version, platform: 'web', deviceId,
  deviceName? }, fetchImpl?, onSignedOut?, onUpgradeRequired? }): PlatformApi` — section 6.
- `createSampleApi({ latencyMs = 450, now?, stress? }): PlatformApi` — in-memory state per
  instance, the platform's rules for the cases the specs name (PIN, 100 % shares, cash
  balance, two-factor demo code `123456` for emails containing `+2fa`), figures computed at
  request time by `portfolioMath` (a line-for-line port of the platform's `positionView`,
  `allocationBySector`, `projectionSeries`, `nextSteps`, `computeEarnings`,
  `getUserAggregates`, `buildLiveKpis`, pinned by a spec to values produced by the
  platform's own functions on the same rows). `stress: true` uses a 40-character brand
  name and a $12,345,678.90 wallet for the overflow audit.
- `MobileApiError { code; status; message; fields: Record<string,string>; detail: string[];
  retryAfterSeconds: number | null }` — every API failure.
- `AppSession` / `useAppSession(): { api; mode; status: 'signed-out' | 'locked' |
  'signed-in'; brand: Brand | null; theme: ThemeId; setTheme; online; signIn(tokens);
  signOut(); lock(); unlock(); confirm(reason): Promise<boolean> }`.
- `themes = { ids; label; tokens(id); accent(hex, id); contrast(a, b); motion(reduced,
  hidden); apply(id, accentHex) }` with `ThemeId = 'orbital' | 'obsidian' | 'ivory' |
  'aurora' | 'verdant' | 'aegis'`.
- `platform` adapters (`src/platform/*`): `storage { get(key), set(key, value), remove }`
  (secret-grade), `lock { available(): Promise<'webauthn' | 'passcode'>, enroll(), verify() }`,
  `notifications { permission(), subscribe(vapidPublicKey), unsubscribe(), show(local) }`,
  `share { files(files, title) }`, `install { canPrompt, prompt(), isInstalled, hint:
  'safari-ios' | 'safari-mac' | null }`, `haptics { tick(), success(), warn() }`. Each has
  a `web` implementation now and a `desktop` slot for sub-project 2; the app picks one at
  startup (`window.__TAURI__` present → desktop).
- `company.config.json` (section 7) → `scripts/apply-company.ts` → generated manifest,
  icons, headers, `VITE_PLATFORM_URL`, and (sub-project 2) `src-tauri/tauri.conf.json`.

## 6. Data flow, session and errors

```
 screens ──hooks──▶ src/queries (TanStack Query, memory cache, networkMode 'online')
                        │
                        ▼
              useAppSession().api : PlatformApi
                ├─ createSampleApi()   company.config.platformUrl === ''
                └─ createLiveApi()     HTTPS → <platformUrl>/api/mobile/v1
```

- **Launch.** `AppSession` reads `company.config` (baked in at build), picks the API, loads
  `GET /brand`, applies the brand (name, tagline, accent, logo, default theme, feature
  switches, legal links, `minSupportedAppVersion`, `vapidPublicKey`) and stores the brand
  locally so sign-in and the offline shell show the right company before the network
  answers. Brand is public data, never investor data. The investor's theme choice lives in
  `localStorage` (`app.theme`); `themes.apply` writes the CSS variables on `<html>`.
- **Sign-in.** Email + password → `POST /auth/login`; `requiresTwoFactor` → the six-digit
  step (backup code toggle). "Create account" and "Forgot password" open `brand.links` in a
  new tab (onboarding rules stay on the platform). Token pair stored (below); device lock
  enrolment offered once per device.
- **Tokens.** Access token in memory only (15 min). Refresh token (30 days) in the secure
  storage adapter: on the web, IndexedDB, encrypted with a non-extractable AES-GCM
  `CryptoKey` kept in IndexedDB (an injected script could use the key, never copy it); on
  desktop, Tauri's stronghold (sub-project 2). Rotation on every refresh; a 401
  `unauthorized` triggers **one** shared refresh and **one** retry per request; a 401
  arriving after another request already refreshed retries once with the newer token; a
  refresh refused with 4xx clears tokens and reports `refresh_failed`; a refresh failing
  with 429, 5xx or no network keeps the session. `session_revoked` → tokens cleared →
  sign-in. `426 upgrade_required` → `UpdateRequired` screen (sign-out still allowed).
  Sign-out posts the refresh token and always clears local tokens.
- **Lock.** `status` goes `signed-in → locked` after five minutes hidden
  (`visibilitychange`) unless the investor turned the lock off, on "Lock now", and on
  launch when a session exists; `unlock()` runs the lock adapter. `confirm(reason)` runs
  the same adapter before every money action and account closure, whatever the lock
  setting, and shows the reason ("Send $1,000.00 to $grace").
- **Online state.** `navigator.onLine` plus the `online`/`offline` events feed TanStack
  Query's `onlineManager`; while offline the banner shows, `Amount` and `CountUp` render
  "•••", mutations are disabled, cached queries stay visible except money figures.
- **Errors.** Every failure is a `MobileApiError`; screens show `message`, map `fields` to
  inputs, never show raw codes. Table (from `MOBILE_API.md`): `invalid_input` → fields;
  `feature_disabled` → the feature's explanatory card; `forbidden` / library codes
  (`kyc_required`, `tier_required`, `pin_required`, `invalid_pin`, `active_holdings`,
  `share_exceeds_100`, `insufficient_balance`) → message inline with the relevant link
  (e.g. `pin_required` → Security); `rate_limited` → "Try again in N s" using
  `Retry-After`; `server_error` → keep the session, offer retry; `network` → offline
  banner; `oracle_unavailable` → the Oracle's own calm text; `payments_not_configured` →
  deposit card explains that card top-ups are off.

## 7. White-label model

`company.config.json` (validated by a zod schema; the template's values are the sample
company):

```json
{
  "platformUrl": "",
  "productName": "Investor App",
  "shortName": "Invest",
  "identifier": "app.investor.template",
  "icon": "branding/icon.png",
  "accentFallback": "#6EA8FF",
  "backgroundColor": "#05070F"
}
```

- `platformUrl` empty → **sample mode** (visible "Sample" ribbon on every screen; any email
  signs in; `+2fa` in the email tries the two-factor step with `123456`). Set to the
  company's HTTPS origin (no trailing slash) → live mode; the platform must list the app's
  origin in `MOBILE_APP_ORIGINS`.
- `scripts/apply-company.ts` runs before every build (`prebuild`) and writes: the web
  manifest (`name`, `short_name`, `id`, `start_url`, `display: standalone`, `theme_color` =
  accent fallback, `background_color`, icons 192 / 512 / maskable 512 / Apple touch 180
  generated from `icon` by `scripts/generate-icons.ts` with sharp), `index.html` title and
  meta, `public/_headers` (CSP with `connect-src` = the platform origin), `.env.production`
  (`VITE_PLATFORM_URL`, `VITE_PRODUCT_NAME`), and in sub-project 2 the Tauri product name,
  identifier and icons. It refuses an invalid config with a clear message and is covered by
  a spec (fictitious company → every output checked).
- Runtime identity (name, tagline, accent, logo, default theme, features, legal links,
  support contacts) always comes from `GET /brand`; the config's values are only the
  install-time identity the OS needs before the app has run.
- Per-company checklist (README): use the template → edit `company.config.json` → replace
  `branding/icon.png` → connect the repo to Cloudflare Pages (or Vercel) → add the app's
  origin to the platform's `MOBILE_APP_ORIGINS` → (sub-project 2) push to `release` for
  installers → (sub-project 3) enter the app address and release repo in the platform's
  admin settings so the website shows the buttons.

## 8. Experience

### Look

- **Orbital** (default): deep-space gradient, faint living starfield (canvas, ~120 stars,
  slow drift and twinkle; a still frame under reduced motion or when hidden; only in
  Orbital and Aurora), glass panels with a hairline border and a top light-catch gradient,
  the company accent as the energy colour along orbits and chart lines, glowing chart
  strokes, count-up numbers, depth transitions between tab and detail screens, haptic
  ticks on refresh, confirm and success.
- **Theme set**: Obsidian Sovereign, Ivory Estate, Quantum Aurora, Verdant Real Assets,
  AEGIS / Orbital Command — palettes from the website's `src/styles/summit-themes.css`
  and `src/styles/aegis.css`, as CSS variable sets in `src/design/tokens.css` (`:root` per
  `[data-theme]`). The company's platform names the default; the investor can switch;
  the choice is remembered on the device. The company accent drives Orbital; the website
  themes keep their own signature accent. Any accent is made readable automatically:
  `accentText` lifted in HSL lightness toward the foreground until ≥ 4.5:1 on background,
  card and surface; `primary` lifted to ≥ 3:1 on the background; `primaryForeground` pure
  black or white, whichever contrasts more; `glow` = `accentText` at 45 % alpha.
- **Type**: Instrument Serif (display), Inter Tight with tabular numerals (UI), JetBrains
  Mono (codes, references); self-hosted `woff2`, latin + latin-ext, precached. Sizes in
  `rem` so text follows the system setting. The frontend-design plugin guides the visual
  pass; the owner's brand colours and copy are kept.
- **Copy**: plain, warm, short; no exclamation marks, no jargon, no promises about returns;
  projections labelled "Projection".

### Layout

- Below 900 px: phone layout — bottom tab bar Home · Portfolio · **Move** (raised centre
  orb) · Legacy · Profile; every header carries the alerts bell (unread badge) and the
  Oracle orb; detail screens use `FlowShell` (back, title, bell, orb, no tab bar);
  safe-area insets honoured.
- 900 px and above: a left navigation rail with the same five destinations plus Alerts and
  Oracle, a centred content column (max 720 px) and side-by-side list/detail panes where a
  list has a detail (holdings ↔ holding, statements ↔ statement, tickets ↔ thread,
  strategies ↔ invest sheet). Same screens, same routes; layout is CSS and a `useLayout()`
  hook, never duplicated screens.

### Screens

| Route | Content | Reads | Writes |
| --- | --- | --- | --- |
| `/sign-in` | Company mark, tagline, email + password, two-factor step (code or backup code), links to register and reset on the website, sample-mode "Explore with sample data" with the hint. | brand | login, loginTwoFactor |
| lock overlay | Brand, "Unlock" (device prompt or passcode), "Sign out instead". | — | — |
| `/` Home | Greeting with first name and tier; portfolio value counting up with the Projection caption, deployed and modelled earnings (compact); cash and wallets; `OrbitalRing` allocation; `ValueChart` projection with 1M / 3M / 1Y / All; KPI chips; next-step cards (`kyc` → verification, `legacy` → Legacy, `maturity` → Move, `activity` → Portfolio activity, `invest` → invest); latest alerts. | dashboard, notifications | — |
| `/portfolio` (+ `?tab=`) | Holdings (plan, sector, value, progress ring, status, matured badge, maturity-choice banner) · Activity (history grouped by month, "newest 200" note) · Statements (monthly / quarterly, period list). | investments, history, statements | — |
| `/portfolio/:positionId` | Value, principal, accrued, term return, progress to maturity, plan facts, withdrawal requests, "Request withdrawal" when allowed (confirm → position withdrawal). | investment | requestWithdrawal |
| `/statements/:periodKey` | Summary, lines, positions marked Projection, "Share PDF" (pdfmake on device → share sheet or download), "Share CSV". | statement, statementCsv | — |
| `/move` | Cash balance, four actions, pending maturity choices (Reinvest / Withdraw with confirm), pending requests. Deposit hidden with an explanatory card when the `deposits` switch is off. | dashboard, investments | maturityChoice |
| `/move/deposit` | Methods (bank: copyable fields; crypto: address + QR + copy), "I've sent it" form (amount, reference) → confirm → pending state; card top-up when `instant !== 'unavailable'` (opens checkout URL; sample mode credits immediately and says so); requests with statuses. | depositMethods | manualDeposit, cardDeposit |
| `/move/withdraw` | Cash payout (≤ balance, destination) and matured positions; confirm; request history. | withdrawals | requestWithdrawal |
| `/move/transfer` | Recipient (`$tag` or email), amount, note, PIN boxes; `pin_required` → link to Security; confirm; transfer list with direction and counterparty. | transfers | sendTransfer |
| `/move/invest` | Strategies with category, projected return (labelled), term, risk, minimum, tier lock, capacity, KYC notice; invest sheet with `AmountField` (≥ minimum, ≤ available) → confirm → success. | strategies, dashboard | invest |
| `/legacy` | Plan overview (title, focus glyph, purpose, horizon); sliders for contribution, return, fee, inflation, horizon, draw rate; projection (nominal vs real chart, ending and real capital, target, coverage meter) recomputed on every move by `legacyPlanModel` (debounced `previewLegacyPlan` in live mode); "Save version" with the 409 "changed elsewhere" message; out-of-range → the model's message inline. Beneficiaries: list with share bars and remainder, add/edit dialog, remove with confirm, `share_exceeds_100` on the share field. | legacyPlan, beneficiaries | saveLegacyPlan, add/update/removeBeneficiary |
| `/profile` | Identity header (name, email, tier, member since); rows to Verification (status chip), Security, Support; seven alert-preference switches; appearance (six swatches, instant apply); app lock toggle; "Install app" row when a prompt or hint applies (section 9); legal links; sign out; close account (password + confirm; `active_holdings` explained). | me | setNotificationPrefs, logout, closeAccount |
| `/profile/verification` | Status with reviewer notes; when `canSubmit`, the website wizard's steps (personal with tax → identity → address → finances → review) with the website's option lists (`kycGeo`), document photo (required) and selfie (optional) via camera/file input downscaled on device (≤ 1600 px, ≤ 1.6 MB), per-field errors, submit → "Under review". Draft lives in component state only. | kyc | submitKyc |
| `/profile/security` | App lock (enrol / disable with confirm), two-factor (enrol shows secret and `otpauth` link, enable with a code shows backup codes once, disable with password), transfer PIN, password change, active sessions with device labels and per-session sign-out (`current` → sign-in). | me, sessions | setPin, changePassword, enroll/enable/disableTwoFactor, revokeSession |
| `/profile/support`, `/profile/support/:ticketId` | Tickets with status chips, "Show older requests", new-ticket dialog (respects the `support` switch); thread with you/support bubbles and a reply box. | supportTickets, ticket | openTicket, replyTicket |
| `/alerts` | Today / Earlier groups, category icon, title, body, amount, relative time, unread dot; tap marks read and opens `alertTarget(alert)`; "Mark all read". | notifications | markRead |
| `/oracle` | Full-screen conversation with the animated orb, suggested questions, typing indicator, answers with model and source count; `feature_disabled`, `rate_limited`, `oracle_unavailable` as calm notices; a failed question returns to the input; sample mode answers the suggested questions from sample data and says so for anything else. | — | oracleAsk |
| update screen | Shown on `426`: company mark, "Update the app", reload / store link; sign-out still works. | brand | logout |

Every list and screen has loading (skeletons in the same layout), empty, error (with retry)
and offline states through `StateView`.

## 9. Installability and offline

- **Manifest** generated per company (section 7): `name`, `short_name`, `id: '/'`,
  `start_url: '/?source=pwa'`, `scope: '/'`, `display: 'standalone'`, `theme_color`,
  `background_color`, icons `192`, `512`, `512 maskable`, `apple-touch-icon` 180, screenshots
  (phone and desktop form factors, produced by `scripts/screenshots.ts` from the sample app
  and committed under `public/screenshots/`, so Chrome shows the richer install dialog; a
  company re-runs the script after branding).
- **Service worker** by `vite-plugin-pwa` (Workbox, `registerType: 'prompt'`): precache
  the app shell (`index.html`, hashed JS/CSS, fonts, icons, manifest); `navigateFallback`
  to `index.html` with `/api` denied; **no runtime caching of API responses** (every
  platform response is `no-store`); the brand logo data URL lives in the stored brand, not
  in the cache. A new version is detected on launch and every hour; the app shows "Update
  available — Reload" and applies it on consent (never mid-flow).
- **Offline**: the shell opens from the cache, shows the stored brand and the offline banner,
  hides money figures, disables actions; a sign-in attempt offline says so.
- **Install UI**: `platform.install` listens for `beforeinstallprompt`, keeps the event and
  exposes `prompt()`; the Install button appears on the sign-in screen and in Profile only
  when a prompt is available or a hint applies; it disappears when `display-mode:
  standalone` matches or `appinstalled` fires. Safari on iPhone/iPad: "Share → Add to Home
  Screen"; Safari on Mac: "File → Add to Dock"; other browsers without a prompt: the
  browser's own install path in one line. Sub-project 3 puts the same Install / Download
  controls on the company website.
- **Installability check**: Playwright attaches a CDP session and asserts
  `Page.getInstallabilityErrors` is empty against the production build served locally; CI
  also runs Lighthouse 11 with `installable-manifest` and `service-worker` assertions.

## 10. Device lock

- `platform.lock.available()` → `'webauthn'` when
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` is true, else
  `'passcode'`.
- **Enrol (WebAuthn)**: `navigator.credentials.create` with `rp.id = location.hostname`,
  `authenticatorSelection { authenticatorAttachment: 'platform', userVerification:
  'required', residentKey: 'preferred' }`, a random challenge, a random user handle (never
  the email); store the credential id and the public key (`getPublicKey()`) in the secure
  storage adapter.
- **Verify**: `navigator.credentials.get` with the stored credential id, `userVerification:
  'required'`, a random challenge; verify the assertion signature locally with WebCrypto
  against the stored public key (origin, rpId hash, challenge checked). It gates the UI;
  the platform session remains the real security.
- **Passcode fallback**: six digits, PBKDF2-SHA256 (310 000 iterations, random salt) in
  secure storage; five wrong attempts → sign out and clear.
- **When**: on launch with a stored session, after five minutes hidden, on "Lock now", and
  as `confirm(reason)` before every money action and account closure — `ConfirmSheet`
  shows the reason and the amount, runs the adapter, and offers Cancel. The lock toggle
  (`app.lockEnabled`, default on) controls only the background lock; confirmations always
  run. Turning the lock off requires a confirmation.

## 11. Notifications and sharing

- **Web Push (sub-project 1 builds the client; sub-project 3 the platform side).** After
  sign-in, when the investor allows alerts, `platform.notifications.subscribe(brand.
  vapidPublicKey)` creates a `PushSubscription` and the app sends it to
  `POST /push/subscribe` `{ endpoint, keys: { p256dh, auth }, platform: 'web' }` (bearer,
  `X-Device-Id`); sign-out and account closure call `POST /push/unsubscribe` and
  `subscription.unsubscribe()`. The platform's `notify()` sends `{ notificationId, title }`
  only — amounts never reach the lock screen — and the service worker's `push` handler
  shows it with the company icon; `notificationclick` opens the app at
  `alertTarget(notification)`. Contract for sub-project 3: `GET /brand` gains
  `vapidPublicKey`; `POST /push/subscribe` and `/push/unsubscribe` are bearer routes;
  the platform stores subscriptions per session and drops them on revocation. The sample
  API accepts the calls and shows a local notification so the flow can be demonstrated.
  Desktop (sub-project 2): native notifications driven by a 60-second poll of
  `GET /notifications` while the app is open.
- **Sharing**: statement PDF rendered on device with `pdfmake` (lazy chunk) from
  `StatementDetail`, branded with the company name and accent; `navigator.canShare({ files })`
  → share sheet, else download; CSV from `statementCsv` the same way. Desktop: save dialog
  (sub-project 2).
- **Haptics**: `navigator.vibrate` where available (Android); silent elsewhere.

## 12. Security

- **Content-Security-Policy** (served by `public/_headers` on Cloudflare, `vercel.json`
  on Vercel, `tauri.conf.json` on desktop): `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  connect-src 'self' <platformUrl>; frame-src <platformUrl> (card checkout);
  worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  `'unsafe-inline'` for styles only (CSS Modules inject none; it covers Radix's inline
  positioning); scripts are never inline.
- Other headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` allowing only camera (verification)
  and publickey-credentials-get.
- **Secrets**: the app has none. `VITE_PLATFORM_URL` is public configuration. `.env.local`
  gitignored. No tokens in URLs or logs.
- **Storage**: section 6; the KYC draft and every image stay in memory; the query cache is
  memory only; `localStorage` holds only `app.theme`, `app.lockEnabled` and the public
  brand.
- **Dependencies**: `npm audit --audit-level=high` in CI, Dependabot weekly, lockfile
  committed, no CDN scripts. Release assets (sub-project 2) ship SHA-256 checksums.
- **Review**: security-guidance findings fixed before merge; pr-review-toolkit on every PR.

## 13. Testing

Tests are written before the code they cover (TDD) and run in CI on every pull request.

- **Unit (Vitest)** — `src/**/*.spec.ts`: `themes` (all tokens present; body and muted
  text ≥ 4.5:1 in every theme; six accents readable as text and buttons; contrast formula;
  motion policy), `format` (money, compact, percent, dates, relative), `legacyPlanModel`
  (exact parity with the platform's `projectLegacyPlan`, including the range error),
  `portfolioMath` (parity with the platform's functions on the generated rows),
  `createSampleApi` (manual deposit pending, PIN required/invalid, mark read lowers unread,
  shares ≤ 100 %, cash limit, two-factor), `createLiveApi` (headers, refresh-and-retry,
  single-flight, revoked, refused refresh, 426, field errors and `Retry-After`, network),
  `tokens` (encrypted storage round trip), `lock` (passcode hashing, attempt limit;
  WebAuthn verification against a fixture assertion), `statementPdf`, `alertTarget`,
  `sampleOracle`, `version` (semver gate), `apply-company` (fictitious company → manifest,
  icons, headers, env; invalid config refused).
- **Component (Vitest + Testing Library + jsdom)** — every screen in loading, empty, error
  and offline states; `Amount` shows "•••" offline; `StateView` variants; `AmountField`
  parsing; the install button's visibility rules.
- **End-to-end (Playwright, Chromium + WebKit, sample mode, production build served
  locally)** — sign-in and sign-in with two-factor (wrong code, right code); sign-up link
  opens the website address; manifest served and valid; service worker registered and
  controlling; offline shell load (`context.setOffline(true)` → shell, banner, no figures);
  installability (`Page.getInstallabilityErrors` empty; Safari hint shown in WebKit);
  update toast on a new build; transfer (PIN required → set PIN → send), invest, maturity
  choice, deposit notice, withdrawal, Legacy slider changes the ending capital, save
  version, beneficiary over 100 % refused, verification submit with a photo, ticket and
  reply, Oracle suggested question, alerts mark read and navigation, theme switch
  persists, lock after hidden (clock mocked) and passcode unlock, 426 update screen.
- **Audits (Playwright)** — overflow at 320×568 on every route with `stress` sample data
  (no horizontal page scroll, no clipped amounts, no element past the right edge, no
  target under 44 px, no unnamed control, no image without alt); contrast of every visible
  text node on its composited background in all six themes (≥ 4.5:1, large text ≥ 3:1);
  axe-core with zero serious or critical issues; reduced motion (count-up renders final
  value immediately, starfield still).
- **Installability in CI** — Lighthouse 11 (`@lhci/cli`) asserting `installable-manifest`
  and `service-worker` on the built app.
- **Verification before completion** — every task ends with the commands and their output
  shown (typecheck, lint, unit, e2e); nothing is called done without them.

## 14. Delivery

- **Repository**: public, MIT, default branch `main`, branch protection (PR + green CI
  required), `release` branch for installers (sub-project 2). One branch per task, small
  commits (commit-commands), a pull request per task reviewed by pr-review-toolkit and
  security-guidance; the owner merges.
- **CI** (`.github/workflows/ci.yml`, on pull requests and `main`): install (npm ci,
  Node 22), `apply-company` for the template, typecheck, lint, unit + component tests,
  build, Playwright (Chromium + WebKit) end-to-end and audits, Lighthouse CI, `npm audit`.
  Artifacts: Playwright report, screenshots of every screen in Orbital and Ivory Estate.
- **Hosting**: Cloudflare Pages by Git integration (build `npm run build`, output `dist`,
  previews per branch and per pull request, custom domain per company); `public/_headers`
  carries the security headers. `vercel.json` with the same headers for anyone previewing
  on Vercel Hobby. No deploy tokens in CI.
- **Repo bot** (`claude.yml`, `claude-review.yml` from the official `claude-code-action`
  examples): `@claude` on issue and PR comments; automatic review with inline comments on
  every PR from branches in the repo. Owner steps: install the Claude GitHub App on the
  repo; run `claude setup-token` locally and save the result as the `CLAUDE_CODE_OAUTH_TOKEN`
  repository secret; merge the workflows PR. Runs use the owner's subscription, not API
  billing.
- **Docs**: `README.md` (what it is, sample vs live, setup, run, test, build, per-company
  checklist, hosting on Cloudflare Pages or Vercel, repo bot setup, where sub-projects 2–4
  pick up), `CLAUDE.md` (project rules: file layout, no fetch in screens, money in cents,
  TDD, commands), `docs/superpowers/specs` and `plans`, `CHANGELOG.md`.

## 15. Reuse of the earlier (Plan B) material

The Floot build is abandoned, but its locally authored files in the platform repo's
`.superpowers/sdd/2026-10-01-mobile-app-plan-b/` backup are React + CSS Modules +
react-router + TanStack Query and port almost one-to-one: twenty page files, six
components (`FlowShell`, `ProgressRing`, `QueryBoundary`, `AmountField`,
`LegacyProjection`, `BeneficiaryEditor`), helpers (`alertTarget` + spec, `sampleOracle` +
spec, `kycGeo`, `appLock`, `imageCapture`, `shareFile`, `flowHeader`), the generated
`mobileTypes.final.tsx` and `sampleData.final.tsx` with `expected.json`, the audit scripts
(`layout.ts`, `contrast.ts`, `flows.ts`) and the splash/icon generator. What was lost with
the Floot project (themes, format, legacy model, portfolio maths, sample API, live client,
session, shell and Home) is rebuilt from the Plan B plan's specs and contracts, which are
reproduced in this spec. Floot's UI kit is replaced by the app's own components on Radix
primitives; Floot's jasmine specs become Vitest specs with the same assertions.

## 16. Out of scope for sub-project 1

Desktop packaging and releases (2); any platform change, the website's "Get the app"
section, live push delivery (3); hosting the platform (4); app-store listings;
administrator features; in-app purchases; referrals, leaderboard and Research Room; offline
data beyond the shell; languages other than English (strings are centralised for later);
analytics.

## 17. Risks and open items

| Item | Handling |
| --- | --- |
| iPhone push requires the Home Screen app and iOS 16.4+ | Profile explains it; the website's Install instructions (sub-project 3) say it; nothing else depends on it. |
| WebAuthn unavailable in some webviews (macOS WKWebView) | Passcode fallback is first-class and tested; a native plugin can replace it on desktop later. |
| Encrypted IndexedDB is still readable by code running on the origin | Strict CSP, no third-party code, short access-token life, revocable sessions on the website; documented honestly in the README. |
| Lighthouse 12+ has no installability audit | Chrome's `Page.getInstallabilityErrors` via Playwright is the real check; Lighthouse 11 pinned for the audit named in the brief. |
| Cloudflare Pages free limits (500 builds / month) | Previews only on pull requests, not every push; Vercel config as a fallback. |
| Vercel Hobby fair use is non-commercial | Used only for personal previews; companies host on Cloudflare Pages (free, commercial permitted) or a plan of their choice. |
| Platform not live | Sub-project 1 needs nothing live; the live client is proven against a scripted platform and, in sub-project 3, against a local one. |
| `GET /brand` lacks `vapidPublicKey` until sub-project 3 | Optional in the type; the subscribe flow is skipped when absent and the sample API supplies a test key. |
| Repo bot token is tied to the owner's subscription | Documented; a company can switch the secret to its own `ANTHROPIC_API_KEY`. |
