// The platform's wire contract (/api/mobile/v1) as the app sees it: every DTO that PlatformApi
// takes or returns. Types only, no runtime code.
//
// Conventions
//   - JSON. Every timestamp (`...At`, `date`, `asOf`, `start`, `end`) is an ISO-8601 UTC string
//     such as "2026-10-01T12:00:00.000Z"; a calendar day is "YYYY-MM-DD" (`dob`, a request's
//     `dateOfBirth`).
//   - Money is integer cents (`...Cents`), in the currency named beside it and USD where none is.
//   - A key that can be empty is present with `null`. Figures marked `basis: 'projection'` are plan
//     projections, never market performance.
//   - Field names are the route handlers', not the plan's; the differences are listed below.
//
// Checked against the platform (.reference/platform):
//   - All 43 route handlers under src/app/api/mobile/v1: auth/login, auth/login/2fa, auth/refresh,
//     auth/logout, brand, me, me/notification-prefs, me/password, me/pin, me/sessions,
//     me/sessions/revoke, me/two-factor/enroll, me/two-factor/enable, me/two-factor/disable,
//     me/close, dashboard, investments, investments/detail, strategies, history, statements,
//     statements/detail, statements/file, notifications, notifications/read, push/ticket,
//     support/tickets, support/ticket, support/reply, deposit/methods, deposit/manual,
//     deposit/checkout, withdrawals, transfers, invest, maturity-choice, kyc, legacy-plan,
//     legacy-plan/preview, beneficiaries, beneficiaries/update, beneficiaries/remove, oracle/ask.
//   - Their route tests (auth, brand, me, portfolio, money, alerts-support, kyc-legacy,
//     oracle/ask), which pin the JSON each route answers.
//   - src/lib/mobile/{views, portfolio, tokens, fields, errors, route, version, ticket}.ts,
//     src/lib/investments/lifecycle.ts, src/lib/legacy-plan/model.ts and docs/MOBILE_API.md.
//   Not staged, so what a handler passes through from them (the statement, the history summary,
//   the deposit methods' and withdrawals' columns, the tickets, the legacy revisions, the
//   beneficiaries, the Oracle's sources, the KYC schema, and `support.phone` in the brand) is as
//   the plan recorded it, checked against the route tests where they show it:
//   src/lib/reporting/statements.ts, account/history.ts, account/beneficiaries.ts, support.ts,
//   notifications/notifications.ts, admin/deposits.ts, manual-withdrawal.ts,
//   investments/withdrawals.ts, funds/transfers.ts, kyc/kyc.ts, legacy-plan/service.ts,
//   ai/oracle-ask.ts and env.ts.
//
// Where the plan differs from the handlers (this file follows the handlers)
//   Plan said `AlertView.currency`; handler returns none: notificationView() sends id, kind,
//     category, title, body, amountCents, entityType, entityId, read and createdAt (an alert's
//     amount has no currency code of its own).
//   Plan said `strategies[].capacity.remaining`; handler returns one `capacity { tier, used, max,
//     remaining, allowed }` beside `strategies[]` (the investor's room for another position) and a
//     `kyc { required, approved }`; each strategy has `unlocked`, `requiredTier` and
//     `minimumCents`.
//   Plan said `dashboard.performance.basis` and `dashboard.totals.portfolioValueCents`; handler
//     returns both, as planned (and `totals.basis` too).
//   Plan said `Withdrawals { cashBalanceCents; requests; maturedPositions }`; handler returns
//     `cashBalanceCents` as planned, `cash[]` (payouts of the cash balance) and `positions[]`
//     (withdrawal requests for a matured position). It sends no list of matured positions: those
//     are the MATURED ones in GET /investments, and `canRequestWithdrawal` is on
//     GET /investments/detail.
//   Plan said `Beneficiaries.summary { totalPercent; remainder }`; handler returns `summary {
//     count, totalShare, remainder }` (`remainder` as planned, no `totalPercent`).
//   Plan said `notifications().unreadCount`; handler returns it, as planned, beside
//     `notifications[]`.
//   Plan said `supportTickets()` answers `{ tickets; hasMore }`; handler returns `{ page, pageSize,
//     total, tickets }`, and another page exists while `page * pageSize < total`.
//   Plan said `markRead()` answers `{ unreadCount }`; handler returns `{ updated, unreadCount }`.
//   Plan said `cardDeposit()` answers `{ url }`; handler returns `{ kind, url, orderId }`.
//   Plan said `StatementDetail { period { key, label }, openingCashCents, closingCashCents,
//     lines[] { date, description, direction 'in' | 'out' | 'info', amountCents },
//     positions[] { plan, valueCents, basis } }`; handler returns `openingBalanceCents` and
//     `closingBalanceCents`, lines that also have `id` and `kind` and a capitalized `direction`
//     ('In' | 'Out' | 'Info'), and positions as `{ investmentId, planName, principalCents, status,
//     startedAt, maturesAt, accruedCents, realizedCents, withdrawableCents }` (no `valueCents`; the
//     basis is stated once, in `bases`). It also returns `asOf`, `totals`, `positionSummary`,
//     `period.kind`, `period.start` and `period.end`.
//   Plan said `DepositOverview { methods; requests; instant }`; handler also returns
//     `cashBalanceCents`.
//   Plan said `LegacyPlanState { plan; revision; projection }`; handler also returns `saved`,
//     `revisionId`, `updatedAt` and `history`.
//   Plan said `Brand` has no `apiVersion`; handler returns `apiVersion: 1`.
//   Plan said `Brand.vapidPublicKey?`; no handler returns one. It is the app's own addition, and
//     the platform route that serves it (with the web-push subscription routes) arrives in a later
//     sub-project.
//   Plan said `openTicket({ subject; message })` and `replyTicket({ id; message })`; handlers read
//     `{ subject, body }` and `{ ticketId, body }`. Those two names are request fields, not DTOs:
//     PlatformApi keeps the plan's and createLiveApi maps them (see PlatformApi.ts).

import type { ThemeId } from '../design/themes';

// ---- Sign-in and session -----------------------------------------------------------------------

/**
 * The token pair. POST /auth/refresh answers exactly this; the sign-in routes add
 * `requiresTwoFactor` to it.
 */
export interface MobileTokens {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  /** The access token lasts 15 minutes. */
  accessExpiresAt: string;
  /** The refresh token lasts 30 days and works once. */
  refreshExpiresAt: string;
}

/**
 * POST /auth/login: the token pair, or, when the account has two-factor on, a challenge to send
 * with the code to POST /auth/login/2fa (which answers the token pair, with `requiresTwoFactor:
 * false` too).
 */
export type LoginResult =
  ({ requiresTwoFactor: false } & MobileTokens) | { requiresTwoFactor: true; challenge: string };

// ---- Brand (public) ----------------------------------------------------------------------------

/**
 * GET /brand: the connected company's identity. Public, and answered even to an app that is below
 * the minimum version.
 */
export interface Brand {
  apiVersion: 1;
  name: string;
  tagline: string;
  /** "#RRGGBB". */
  accentHex: string;
  /** A data URL (png, jpeg, webp or svg), or null when no logo is uploaded. */
  logoDataUrl: string | null;
  defaultTheme: ThemeId;
  /** The themes the app offers, in order. */
  themes: ThemeId[];
  /** "major.minor.patch": an app below it is answered 426 `upgrade_required`. */
  minSupportedAppVersion: string;
  features: { kyc: boolean; deposits: boolean; oracle: boolean; support: boolean };
  /** Where to get the native apps. */
  stores: { appStore: string | null; googlePlay: string | null; androidDirect: string | null };
  /** Absolute URLs on the company's website. */
  links: {
    website: string;
    privacy: string;
    terms: string;
    register: string;
    forgotPassword: string;
  };
  support: { email: string; phone: string | null };
  /** The public key a push subscription is made with. Not sent by the platform yet. */
  vapidPublicKey?: string;
}

// ---- Account: profile, security, sessions ------------------------------------------------------

export type KycStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'RESUBMIT';

/** Investor access tiers; each allows more open positions, from 1 (Standard) to 5 (Elite). */
export type InvestorTier = 'STANDARD' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'ELITE';

export interface TierView {
  id: InvestorTier;
  /** "Standard", "Silver", "Gold", "Platinum" or "Elite". */
  label: string;
}

export type NotificationCategory =
  'deposit' | 'withdrawal' | 'referral' | 'support' | 'kyc' | 'security' | 'system';

/** All seven categories are always present. They gate the email and the push alerts. */
export type NotificationPrefs = Record<NotificationCategory, boolean>;

/** GET /me. */
export interface Me {
  id: string;
  fullName: string;
  /** The first word of `fullName`. */
  firstName: string;
  email: string;
  /** The $tag people send money to, without the "$"; null until the investor has one. */
  tag: string | null;
  emailVerified: boolean;
  kycStatus: KycStatus;
  tier: TierView;
  security: {
    twoFactorEnabled: boolean;
    /** A transfer PIN is set; sending money needs one. */
    pinEnabled: boolean;
  };
  notificationPrefs: NotificationPrefs;
  unreadCount: number;
  memberSince: string;
  lastLoginAt: string | null;
  /** The session of the access token that made the call. It changes on every refresh. */
  sessionId: string;
}

/** An entry of GET /me/sessions: the investor's live sessions, newest first. */
export interface SessionView {
  id: string;
  /** A label such as "iOS app on Ada's iPhone" or "Chrome on Windows". */
  device: string;
  ipAddress: string | null;
  issuedAt: string;
  expiresAt: string;
  /** Past its expiry although not revoked. */
  expired: boolean;
  /** The session of the access token that made the call. */
  current: boolean;
}

// ---- Alerts and push ---------------------------------------------------------------------------

/**
 * An alert: GET /notifications and `Dashboard.alerts.latest`. `entityType` and `entityId` name the
 * record it is about ("manualDeposit", "supportTicket", ...) but are free labels the emitting code
 * chose, so route by `category` first.
 */
export interface AlertView {
  id: string;
  /** The event, such as "kyc_approved" or "manual_deposit_approved". Kinds are added over time. */
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Cents; the platform sends no currency code with an alert. */
  amountCents: number | null;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

/** GET /notifications?limit=: newest first, with the number of unread alerts in all. */
export interface NotificationList {
  unreadCount: number;
  notifications: AlertView[];
}

/** POST /notifications/read. */
export interface MarkReadResult {
  /** False when nothing changed: the id named an alert that is not this investor's or is read. */
  updated: boolean;
  unreadCount: number;
}

/** A browser's web-push subscription, as PushSubscription.toJSON() makes it. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: 'web';
}

// ---- Portfolio ---------------------------------------------------------------------------------

/** GET /dashboard. Every figure is a plan projection (`basis: 'projection'`), not market data. */
export interface Dashboard {
  asOf: string;
  user: { firstName: string; tier: TierView; kycStatus: KycStatus };
  totals: {
    basis: 'projection';
    /** The principal of the ACTIVE and MATURED positions. */
    deployedCents: number;
    /** `deployedCents` plus `earningsCents`. */
    portfolioValueCents: number;
    earningsCents: number;
    /** The plan rates, weighted by what is deployed, in percent to one decimal. */
    projectedYieldPct: number;
    positionCount: number;
    activeCount: number;
    maturedCount: number;
  };
  cash: {
    /** The cash ledger's balance: what a cash withdrawal can draw on. */
    balanceCents: number;
    /** Transfers and investing spend a wallet's `availableCents`, not the cash balance. */
    wallets: Wallet[];
  };
  /** Always four, in this order: Projected Portfolio, Estimated Earnings, Projected Yield, Rank. */
  kpis: DashboardKpi[];
  allocation: AllocationSlice[];
  performance: { basis: 'projection'; points: PerformancePoint[] };
  nextSteps: NextStep[];
  alerts: {
    unreadCount: number;
    /** The five newest. */
    latest: AlertView[];
  };
}

/** One wallet per currency. */
export interface Wallet {
  currency: string;
  /** What can be spent: transfers and investing. */
  availableCents: number;
  /** Deployed in positions. */
  lockedCents: number;
}

export interface DashboardKpi {
  label: string;
  /** Text to show as it is: "$12,345", "8.5%", "#7", or "—" when unranked. */
  value: string;
  hint: string;
  /** Always 'projection' today. */
  basis: 'records' | 'projection' | 'illustrative';
}

/** A share of the deployed capital, by sector (by plan name when a plan has no sector). */
export interface AllocationSlice {
  label: string;
  valueCents: number;
  /** In percent to one decimal. */
  weightPct: number;
}

/** A point of the projected value path: up to 24, evenly spaced; none without a dated position. */
export interface PerformancePoint {
  date: string;
  valueCents: number;
}

export type NextStepTarget = 'kyc' | 'legacy' | 'maturity' | 'activity' | 'invest';

/** What to do next: link by `target`. */
export interface NextStep {
  id: string;
  title: string;
  detail: string;
  target: NextStepTarget;
}

export type InvestmentStatus = 'PENDING' | 'ACTIVE' | 'MATURED' | 'WITHDRAWN' | 'CANCELLED';

export interface PositionPlan {
  id: string;
  name: string;
  slug: string;
  symbol: string | null;
  sector: string | null;
  /** An offering-taxonomy key such as "REAL_ESTATE" or "PRE_IPO". */
  assetClass: string;
  /** The plan's annual rate, in percent. */
  projectedReturnPct: number;
  termMonths: number;
}

/**
 * A position: an entry of GET /investments and the `position` of GET /investments/detail. Its
 * figures are plan-rate projections, not market values.
 */
export interface PositionView {
  id: string;
  status: InvestmentStatus;
  currency: string;
  basis: 'projection';
  plan: PositionPlan;
  principalCents: number;
  /** The time-weighted accrual so far (the whole term's return once matured); 0 without dates. */
  accruedCents: number;
  /** The whole term's return: principal x rate x months / 12; 0 without dates. */
  termReturnCents: number;
  /** `principalCents` plus `accruedCents`. */
  valueCents: number;
  /** 0 to 100, one decimal; 100 once MATURED or WITHDRAWN. */
  progressPct: number;
  /** Null while PENDING or CANCELLED. */
  startedAt: string | null;
  maturesAt: string | null;
  closedAt: string | null;
  createdAt: string;
  /** Positions bought together share a reference; null for one bought alone. */
  basketRef: string | null;
}

/** A matured position waiting for REINVEST or WITHDRAW; a choice not made by `expiresAt` lapses. */
export interface MaturityChoiceView {
  id: string;
  investmentId: string;
  planName: string;
  amountCents: number;
  currency: string;
  expiresAt: string;
}

/** GET /investments: the newest 200 positions of every status, and the pending maturity choices. */
export interface Investments {
  asOf: string;
  positions: PositionView[];
  /** Earliest expiry first. */
  maturityChoices: MaturityChoiceView[];
}

export type PositionWithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED';

/** A request to withdraw one matured position. */
export interface PositionWithdrawal {
  id: string;
  status: PositionWithdrawalStatus;
  amountCents: number;
  /** The reviewer's note. */
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** GET /investments/detail?id=. */
export interface InvestmentDetail {
  asOf: string;
  position: PositionView;
  /** This position's withdrawal requests, newest first. */
  withdrawals: PositionWithdrawal[];
  /** MATURED, with no request PENDING, APPROVED or PAID. */
  canRequestWithdrawal: boolean;
}

export interface Strategy {
  id: string;
  slug: string;
  name: string;
  summary: string;
  symbol: string | null;
  assetClass: string;
  /** The label of `assetClass` in the platform's offering taxonomy (the key when it has none). */
  category: string;
  sector: string | null;
  projectedReturnPct: number;
  termMonths: number;
  /** 1 (conservative) to 5 (aggressive). */
  riskRating: number;
  flagship: boolean;
  /** The effective minimum: the larger of the plan's own and the platform's. */
  minimumCents: number;
  /** The tier a premium plan needs; null when every tier may invest. */
  requiredTier: TierView | null;
  /** The investor's tier meets `requiredTier` (always true when that is null). */
  unlocked: boolean;
}

/**
 * GET /strategies: the active plans, flagship first and then by rising risk, with the rules that
 * checkout enforces.
 */
export interface Strategies {
  capacity: {
    tier: TierView;
    /** Open positions: PENDING, ACTIVE and MATURED. */
    used: number;
    /** What the tier allows. */
    max: number;
    remaining: number;
    /** `used` is below `max`. */
    allowed: boolean;
  };
  kyc: {
    /** The platform's `kyc` switch. */
    required: boolean;
    /** Verified, or true when verification is not required. */
    approved: boolean;
  };
  strategies: Strategy[];
}

export type HistoryKind = 'deposit' | 'maturity' | 'withdrawal_paid' | 'withdrawal_rejected';

/** By kind: `deposit` is PAID, `maturity` MATURED or WITHDRAWN, a withdrawal PAID or REJECTED. */
export type HistoryStatus = 'PAID' | 'MATURED' | 'WITHDRAWN' | 'REJECTED';

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  /** When it took effect: paid, closed or processed. */
  date: string;
  title: string;
  detail: string;
  amountCents: number | null;
  status: HistoryStatus;
}

/** GET /history: newest first. */
export interface History {
  summary: {
    totalDepositedCents: number;
    totalWithdrawnCents: number;
    /** 0 here: read the portfolio value from Dashboard.totals.portfolioValueCents. */
    portfolioValueCents: number;
    /** Deposited minus withdrawn; negative when more went out. */
    netCents: number;
  };
  /** The newest 200; the summary covers them all. */
  entries: HistoryEntry[];
  /** More than 200 entries exist. */
  truncated: boolean;
}

export type StatementKind = 'monthly' | 'quarterly';

export interface StatementPeriod {
  /** "2026-09" (monthly) or "2026-Q3" (quarterly). */
  key: string;
  /** "September 2026" or "Q3 2026". */
  label: string;
  /** The first instant of the period, UTC. */
  start: string;
  /** The first instant of the next period, UTC. */
  end: string;
}

/** GET /statements?kind=: newest first, from the investor's first activity to the current one. */
export interface StatementPeriods {
  kind: StatementKind;
  periods: StatementPeriod[];
}

export type StatementLineKind =
  | 'deposit'
  | 'withdrawal'
  | 'maturity'
  | 'manual_credit'
  | 'manual_debit'
  | 'adjustment'
  | 'referral_commission';

export interface StatementLine {
  id: string;
  kind: StatementLineKind;
  date: string;
  description: string;
  /** Signed: money in is positive, money out negative. */
  amountCents: number | null;
  /** 'Info' for a maturity, where no cash moves. */
  direction: 'In' | 'Out' | 'Info';
}

/** An ACTIVE or MATURED position in a statement. */
export interface StatementPosition {
  investmentId: string;
  planName: string;
  principalCents: number;
  status: 'ACTIVE' | 'MATURED';
  startedAt: string | null;
  maturesAt: string | null;
  accruedCents: number;
  /** The plan's projected return once matured; 0 while ACTIVE. */
  realizedCents: number;
  /** Principal plus `realizedCents` once matured; 0 while ACTIVE. */
  withdrawableCents: number;
}

/** GET /statements/detail?period=: the data the app renders into its own PDF. */
export interface StatementDetail {
  period: StatementPeriod & { kind: StatementKind };
  /** The end of the period, or now while it is running. */
  asOf: string;
  holder: { fullName: string; email: string };
  currency: 'USD';
  /** Where the figures come from: the cash ledger is on record, the positions are projections. */
  bases: { cash: 'records'; positions: 'projection' };
  openingBalanceCents: number;
  closingBalanceCents: number;
  totals: {
    depositsCents: number;
    withdrawalsCents: number;
    referralCents: number;
    manualCreditsCents: number;
    /** An absolute value. */
    manualDebitsCents: number;
    maturitiesCents: number;
    /** The projected returns of the maturities in the period, not a realized profit. */
    realizedYieldCents: number;
  };
  /** Newest first. */
  lines: StatementLine[];
  /** Largest principal first. */
  positions: StatementPosition[];
  positionSummary: {
    deployedCents: number;
    earningsCents: number;
    portfolioValueCents: number;
    positionCount: number;
  };
}

// ---- Support -----------------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface TicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

/** GET /support/tickets?page=: newest activity first, 20 to a page. */
export interface TicketList {
  page: number;
  pageSize: number;
  total: number;
  tickets: TicketSummary[];
}

export interface TicketMessage {
  id: string;
  /** Staff are always "support": their accounts never reach the app. */
  from: 'support' | 'you';
  body: string;
  createdAt: string;
}

/** GET /support/ticket?id=. */
export interface TicketThread extends TicketSummary {
  /** Oldest first. */
  messages: TicketMessage[];
}

// ---- Deposits ----------------------------------------------------------------------------------

/** An enabled way to pay in, as GET /deposit/methods lists it. */
export interface DepositMethod {
  id: string;
  /** "bitcoin", "ethereum", "paypal", "cashapp", "bank" or "other"; administrators can add more. */
  kind: string;
  /** The heading to group under: "Cryptocurrency", "Bank", "E-wallet", "Other" or a custom one. */
  category: string | null;
  /** The name to show, such as "Bitcoin". */
  label: string;
  logoUrl: string | null;
  /** Such as "ERC-20". */
  network: string | null;
  instructions: string | null;
  /** A wallet address, email or $cashtag; empty for a bank method. */
  address: string;
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  /** Also holds a SWIFT/BIC or an IBAN. */
  routingNumber: string | null;
  /** What the QR code encodes: the account number for a bank method, else the address. */
  qrValue: string | null;
  /** A 320 px PNG data URL of `qrValue`; null when there is nothing to encode. */
  qrDataUrl: string | null;
}

export type DepositRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A manual deposit the investor filed, as listed in GET /deposit/methods (the newest 50). */
export interface DepositRequest {
  id: string;
  /** The method's kind and label when the request was filed. */
  methodKind: string;
  methodLabel: string | null;
  amountCents: number;
  reference: string | null;
  status: DepositRequestStatus;
  /** The reviewer's note. */
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** GET /deposit/methods. */
export interface DepositOverview {
  /**
   * Card top-ups: 'live' when Stripe is set up, 'sandbox' when it is not and the platform is not in
   * production (the top-up is simulated and credited at once), 'unavailable' otherwise.
   */
  instant: 'live' | 'sandbox' | 'unavailable';
  /** The cash ledger's balance (Dashboard.cash.balanceCents). */
  cashBalanceCents: number;
  methods: DepositMethod[];
  requests: DepositRequest[];
}

/**
 * POST /deposit/checkout. 'stripe': open `url` in the in-app browser, which ends on the app's
 * return page. 'simulated': Stripe is not set up (outside production), so the top-up is already
 * credited and `url` is the success page.
 */
export interface CardDepositResult {
  kind: 'stripe' | 'simulated';
  url: string;
  orderId: string;
}

// ---- Withdrawals -------------------------------------------------------------------------------

export type CashWithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

/** A payout of the cash balance, as GET /withdrawals lists it (the newest 50). */
export interface CashWithdrawalRecord {
  id: string;
  amountCents: number;
  destination: string | null;
  status: CashWithdrawalStatus;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** A matured position's withdrawal request, as GET /withdrawals lists it. */
export interface PositionWithdrawalRecord extends PositionWithdrawal {
  investmentId: string;
  planName: string;
}

/** GET /withdrawals. */
export interface Withdrawals {
  /** The cash ledger's balance: what a cash payout can draw on. */
  cashBalanceCents: number;
  /** Newest first. */
  cash: CashWithdrawalRecord[];
  /** Newest first. */
  positions: PositionWithdrawalRecord[];
}

/** What POST /withdrawals answers: the request just filed, awaiting review. */
export interface WithdrawalRequest {
  kind: 'cash' | 'position';
  /** The payout's id for 'cash', the position withdrawal request's id for 'position'. */
  id: string;
  amountCents: number;
  status: 'PENDING';
}

// ---- Transfers ---------------------------------------------------------------------------------

export type TransferStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** A transfer between investors, as GET /transfers lists it. */
export interface TransferView {
  id: string;
  /** 'out' was sent by this investor, 'in' was received. */
  direction: 'out' | 'in';
  amountCents: number;
  currency: string;
  note: string | null;
  status: TransferStatus;
  createdAt: string;
  /** The other person, by name and $tag only: their email never reaches the app. */
  counterparty: {
    /** Null for someone whose account was removed. */
    name: string | null;
    /** Without the "$"; null when they have none. */
    tag: string | null;
  };
}

/** GET /transfers: the latest 50 sent and 50 received, newest first. */
export interface Transfers {
  wallets: Wallet[];
  transfers: TransferView[];
}

// ---- Identity verification (KYC) ---------------------------------------------------------------

/** GET /kyc (readable with the `kyc` switch off). */
export interface KycOverview {
  /** The platform's `kyc` switch: when false, verification is not needed to invest. */
  required: boolean;
  status: KycStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  /** False while a submission is PENDING. */
  canSubmit: boolean;
  /** The newest submission's review; null before the first. */
  latest: {
    id: string;
    status: Exclude<KycStatus, 'NONE'>;
    /** The reviewer's note. */
    notes: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
}

export type KycDocType = 'PASSPORT' | 'DRIVERS_LICENSE' | 'NATIONAL_ID';

/**
 * POST /kyc: the website's submission schema. The platform trims the text; the limits are on the
 * trimmed text. A residence country of "US" also needs a 2-letter `state` and a ZIP (12345 or
 * 12345-6789); a tax country of "US" needs a 9-digit SSN or ITIN as `taxId`.
 */
export interface KycSubmission {
  /** 2 to 120 characters. */
  legalName: string;
  /** "YYYY-MM-DD"; at least 18 years ago. */
  dob: string;
  /** ISO 3166 alpha-2, two capitals: the country of residence. */
  country: string;
  /** ISO 3166 alpha-2. */
  nationality: string;
  /** A valid email, up to 200 characters. */
  email?: string;
  /** Up to 40 characters. */
  phone?: string;
  /** ISO 3166 alpha-2: where tax is paid. */
  taxCountry: string;
  /** 3 to 40 characters. */
  taxId: string;
  docType: KycDocType;
  /** 3 to 120 characters. */
  docReference: string;
  /** A PNG, JPEG or WebP data URL of at most 1 600 000 characters. */
  documentImage?: string;
  /** The selfie: the same format and limit. */
  selfieImage?: string;
  /** 3 to 120 characters. */
  street1: string;
  /** Up to 120 characters. */
  street2?: string;
  /** 2 to 85 characters. */
  city: string;
  /** 1 to 85 characters; a 2-letter code for a US address. */
  state: string;
  /** 2 to 12 characters. */
  postalCode: string;
  /** The address as one line, up to 600 characters. */
  addressLines?: string;
  /** 1 to 60 characters. */
  employmentStatus: string;
  /** Up to 120 characters. */
  occupation?: string;
  /** 1 to 80 characters. */
  sourceOfFunds: string;
  /** 1 to 60 characters. */
  annualIncome: string;
  /** 1 to 60 characters. */
  investmentExperience: string;
}

// ---- Legacy plan -------------------------------------------------------------------------------

export type LegacyFocus = 'freedom' | 'family' | 'resilience' | 'impact';

export type LegacyReviewCadence = 'monthly' | 'quarterly' | 'annually';

/**
 * A personal planning scenario, never connected to balances, fees or payouts. The platform's
 * schema is strict: no other keys are accepted. Money is integer cents; rates are basis points
 * (100 is 1%).
 */
export interface LegacyPlan {
  schemaVersion: 1;
  currency: 'USD';
  /** 3 to 80 characters. */
  title: string;
  focus: LegacyFocus;
  /** 10 to 800 characters. */
  purpose: string;
  /** 1 to 50. */
  horizonYears: number;
  /** 0 to 100 000 000 000. */
  startingCapitalCents: number;
  /** 0 to 100 000 000. */
  monthlyContributionCents: number;
  /** In today's money; 0 to 100 000 000. */
  monthlyIncomeGoalCents: number;
  /** 0 to 100 000 000. */
  monthlySpendingCents: number;
  /** 1 to 36. */
  reserveMonths: number;
  /** -3000 to 3000. */
  annualReturnBps: number;
  /** 0 to 1000. */
  annualFeeBps: number;
  /** 0 to 2000. */
  inflationBps: number;
  /** 0 to 2000; 0 means no target capital. */
  annualDrawBps: number;
  reviewCadence: LegacyReviewCadence;
  /** Up to 2000 characters, and may be empty. */
  futureLetter: string;
  commitments: {
    reviewBudget: boolean;
    documentLiquidity: boolean;
    challengeAssumptions: boolean;
    discussContinuity: boolean;
  };
}

/** One point of the projection: year 0 is the starting capital, then one per year of the plan. */
export interface LegacyProjectionPoint {
  year: number;
  nominalCents: number;
  /** In today's money (adjusted for inflation). */
  realCents: number;
  /** The starting capital plus the contributions so far. */
  contributionCents: number;
}

/** The website's projection engine's answer, for GET /legacy-plan and POST /legacy-plan/preview. */
export interface LegacyProjection {
  classification: 'PERSONAL_PLANNING_SCENARIO';
  points: LegacyProjectionPoint[];
  endingCapitalCents: number;
  realCapitalCents: number;
  plannedContributionsCents: number;
  /** Negative when `annualReturnBps` is. */
  modelledGainsCents: number;
  modelledFeesCents: number;
  /** `monthlySpendingCents` x `reserveMonths`. */
  reserveGoalCents: number;
  futureMonthlyIncomeGoalCents: number;
  /** Null when `annualDrawBps` is 0. */
  targetCapitalCents: number | null;
  modelledMonthlyDrawCents: number;
  realMonthlyDrawCents: number;
  /** Ending capital against the target, in percent (one decimal, at most 999); null without one. */
  coveragePercent: number | null;
  /** How many of the four commitments are ticked. */
  completedCommitments: number;
}

/** One saved version of the plan. */
export interface LegacyRevisionSummary {
  id: string;
  revision: number;
  createdAt: string;
}

/**
 * GET /legacy-plan. Before the first save: `saved` is false, `revision` 0, `revisionId` and
 * `updatedAt` null, `history` empty and `plan` the platform's default. `revision` is what a save
 * sends back as `expectedRevision`.
 */
export interface LegacyPlanState {
  saved: boolean;
  revision: number;
  revisionId: string | null;
  updatedAt: string | null;
  /** The latest 12 versions, newest first. */
  history: LegacyRevisionSummary[];
  plan: LegacyPlan;
  projection: LegacyProjection;
}

// ---- Beneficiaries -----------------------------------------------------------------------------

export type BeneficiaryRelationship = 'spouse' | 'child' | 'parent' | 'sibling' | 'other';

export interface Beneficiary {
  id: string;
  fullName: string;
  relationship: BeneficiaryRelationship;
  /** Midnight UTC of the birth date ("1980-04-12T00:00:00.000Z"); a request sends "1980-04-12". */
  dateOfBirth: string | null;
  /** 1 to 100. */
  sharePercent: number;
  createdAt: string;
  updatedAt: string;
}

/** The fields of POST /beneficiaries. An investor's shares may total at most 100. */
export interface BeneficiaryInput {
  /** 1 to 120 characters. */
  fullName: string;
  relationship: BeneficiaryRelationship;
  /** A whole number from 1 to 100. */
  sharePercent: number;
  /** "YYYY-MM-DD", or null or left out. */
  dateOfBirth?: string | null;
}

/** GET /beneficiaries. */
export interface Beneficiaries {
  /** Oldest first. */
  beneficiaries: Beneficiary[];
  summary: {
    count: number;
    /** The sum of the shares. */
    totalShare: number;
    /** 100 minus `totalShare`, never below 0: the room left for another beneficiary. */
    remainder: number;
  };
}

// ---- Oracle ------------------------------------------------------------------------------------

export interface OracleSource {
  id: string;
  /** Up to 200 characters. */
  snippet: string;
  score: number;
}

/** POST /oracle/ask (the `oracle` switch). */
export interface OracleAnswer {
  conversationId: string;
  /** The answer text. */
  answer: string;
  model: string;
  latencyMs: number;
  retrieved: { knowledge: OracleSource[]; conversations: OracleSource[] };
}

// ---- Errors ------------------------------------------------------------------------------------

/**
 * The JSON body of every error answer: { error: '<code>', message?, ...details }. MobileApiError is
 * built from it. `message` is the platform's text for the person and can be absent.
 */
export interface ApiErrorBody {
  error: string;
  message?: string;
  /** `invalid_input`: field name (a zod path joined by ".", or "_" for the body) to its message. */
  fields?: Record<string, string>;
  /** Library errors that carry a list, such as `weak_password` and `share_exceeds_100`. */
  detail?: string[];
  /** `feature_disabled`: which switch is off. */
  feature?: 'kyc' | 'deposits' | 'support' | 'oracle';
  /** `upgrade_required`: the administrator's minimum, "major.minor.patch". */
  minSupportedAppVersion?: string;
  /** `rate_limited`: seconds until the limit resets (also the Retry-After header). */
  retryAfterSeconds?: number;
}
