// The one interface the screens talk to, through the hooks in src/queries. createSampleApi serves
// it from an in-memory world and createLiveApi from the platform over HTTPS (/api/mobile/v1).
//
// A mutation answers what the platform's route answers, and nothing more: screens refresh what it
// changed through query invalidation. Where a request field has another name on the wire, the
// method's comment says so. Every method rejects with a MobileApiError.

import type {
  Beneficiaries,
  BeneficiaryInput,
  BeneficiaryResult,
  Brand,
  CardDepositResult,
  Dashboard,
  DepositOverview,
  History,
  InvestmentDetail,
  Investments,
  InvestResult,
  KycOverview,
  KycSubmission,
  KycSubmitResult,
  LegacyPlan,
  LegacyPlanState,
  LegacyProjection,
  LoginResult,
  ManualDepositResult,
  MarkReadResult,
  Me,
  MobileTokens,
  NotificationCategory,
  NotificationList,
  NotificationPrefsResult,
  OpenTicketResult,
  OracleAnswer,
  PushSubscriptionInput,
  SaveLegacyPlanResult,
  SessionView,
  StatementDetail,
  StatementKind,
  StatementPeriods,
  Strategies,
  TicketList,
  TicketThread,
  Transfers,
  TransferResult,
  Withdrawals,
  WithdrawalRequest,
} from './types';

export interface PlatformApi {
  /** 'sample': an in-memory world; 'live': the platform over HTTPS. */
  readonly mode: 'sample' | 'live';

  // ---- Sign-in and session

  /** POST /auth/login. */
  login(body: { email: string; password: string }): Promise<LoginResult>;
  /** POST /auth/login/2fa. With `useBackup`, `code` is a one-time backup code, not a TOTP code. */
  loginTwoFactor(body: {
    challenge: string;
    code: string;
    useBackup?: boolean;
  }): Promise<MobileTokens>;
  /**
   * POST /auth/refresh with the stored refresh token. Each token works once, so the new pair is
   * stored while the store still holds that sign-in, and concurrent callers share one request.
   * Resolves the new pair only while the store still holds the sign-in it renewed; otherwise, and
   * with no session stored (when it sends nothing), it rejects `unauthorized`.
   */
  refresh(): Promise<MobileTokens>;
  /**
   * POST /auth/logout with the stored tokens, once; the platform answers `{ ok: true }` regardless,
   * and a failure is ignored. The live client clears the stored tokens before it sends, and never
   * refreshes, retries or calls onSignedOut; it rejects only when its token store fails. With
   * `sessionKey`, it ends only that sign-in: when the store holds another, it clears nothing and
   * sends nothing (another sign-in holds this device), and resolves. The sample ignores the key.
   */
  logout(sessionKey?: string): Promise<void>;
  /** GET /brand. */
  brand(): Promise<Brand>;

  // ---- Account

  /** GET /me. */
  me(): Promise<Me>;
  /** POST /me/notification-prefs with all seven categories; answers them as saved. */
  setNotificationPrefs(
    prefs: Record<NotificationCategory, boolean>,
  ): Promise<NotificationPrefsResult>;
  /** POST /me/password. */
  changePassword(body: { currentPassword: string; newPassword: string }): Promise<void>;
  /** POST /me/pin: the transfer PIN, 4 to 8 digits. */
  setPin(body: { currentPassword: string; pin: string }): Promise<void>;
  /** GET /me/sessions. The platform wraps the list as `{ sessions }`. */
  sessions(): Promise<SessionView[]>;
  /** POST /me/sessions/revoke with `{ sessionId }`. `current: true`: this device signed out. */
  revokeSession(sessionId: string): Promise<{ ok: true; current: boolean }>;
  /** POST /me/two-factor/enroll: the secret to add to an authenticator app; not active yet. */
  enrollTwoFactor(body: {
    currentPassword: string;
  }): Promise<{ secret: string; uri: string; account: string }>;
  /** POST /me/two-factor/enable with a code from the authenticator. The backup codes show once. */
  enableTwoFactor(body: { code: string }): Promise<{ backupCodes: string[] }>;
  /** POST /me/two-factor/disable. */
  disableTwoFactor(body: { currentPassword: string }): Promise<void>;
  /** POST /me/close: ends every session, and is refused while a position is ACTIVE or MATURED. */
  closeAccount(body: { currentPassword: string }): Promise<void>;

  // ---- Portfolio

  /** GET /dashboard. */
  dashboard(): Promise<Dashboard>;
  /** GET /investments. */
  investments(): Promise<Investments>;
  /** GET /investments/detail?id=. */
  investment(id: string): Promise<InvestmentDetail>;
  /** GET /strategies. */
  strategies(): Promise<Strategies>;
  /** GET /history. */
  history(): Promise<History>;
  /** GET /statements?kind=. */
  statements(kind: StatementKind): Promise<StatementPeriods>;
  /** GET /statements/detail?period=, a key such as "2026-09" or "2026-Q3". */
  statement(period: string): Promise<StatementDetail>;
  /** GET /statements/file?period=: the statement as CSV text. */
  statementCsv(period: string): Promise<string>;

  // ---- Alerts and push

  /** GET /notifications?limit= (1 to 100, 50 when left out), newest first. */
  notifications(limit?: number): Promise<NotificationList>;
  /** POST /notifications/read with `{ id }` for that alert, or without an id for all of them. */
  markRead(id?: string): Promise<MarkReadResult>;
  /**
   * Registers this browser's push subscription with the platform, and removes it again. These two
   * are the app's own: the platform has no such routes yet (its POST /push/ticket serves the native
   * apps' relay), and they arrive with the sub-project that adds web push.
   */
  pushSubscribe(subscription: PushSubscriptionInput): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;

  // ---- Support

  /** GET /support/tickets?page= (page 1 when left out): 20 to a page, newest activity first. */
  supportTickets(page?: number): Promise<TicketList>;
  /**
   * POST /support/tickets with `{ subject, body }`; `message` here is the platform's `body`. Obeys
   * the `support` switch.
   */
  openTicket(body: { subject: string; message: string }): Promise<OpenTicketResult>;
  /** GET /support/ticket?id=. */
  ticket(id: string): Promise<TicketThread>;
  /**
   * POST /support/reply with `{ ticketId, body }`; `id` and `message` here are the platform's
   * `ticketId` and `body`. The platform answers `{ ok: true }`. It works with the `support` switch
   * off.
   */
  replyTicket(body: { id: string; message: string }): Promise<void>;

  // ---- Money

  /** GET /deposit/methods (the `deposits` switch). */
  depositMethods(): Promise<DepositOverview>;
  /**
   * POST /deposit/manual (the `deposits` switch): files a request for review. The answer carries
   * the method's `address`.
   */
  manualDeposit(body: {
    methodId: string;
    amountCents: number;
    reference?: string;
  }): Promise<ManualDepositResult>;
  /** POST /deposit/checkout (the `deposits` switch): a card top-up that is finished at `url`. */
  cardDeposit(body: { amountCents: number }): Promise<CardDepositResult>;
  /** GET /withdrawals. */
  withdrawals(): Promise<Withdrawals>;
  /** POST /withdrawals: a payout of the cash balance, or the withdrawal of one matured position. */
  requestWithdrawal(
    body:
      | { kind: 'cash'; amountCents: number; destination?: string }
      | { kind: 'position'; investmentId: string },
  ): Promise<WithdrawalRequest>;
  /** GET /transfers. */
  transfers(): Promise<Transfers>;
  /** POST /transfers. `recipient` is an email or a $tag; `currency` is USD when left out. */
  sendTransfer(body: {
    recipient: string;
    amountCents: number;
    currency?: string;
    note?: string;
    pin: string;
  }): Promise<TransferResult>;
  /** POST /invest, paid from the available wallet balance. */
  invest(body: { planId: string; amountCents: number }): Promise<InvestResult>;
  /**
   * POST /maturity-choice. Without `choiceId` it takes the earliest pending choice, and REINVEST
   * needs a `planId`. The platform answers `{ ok: true }`.
   */
  maturityChoice(body: {
    choiceId?: string;
    choice: 'REINVEST' | 'WITHDRAW';
    planId?: string;
  }): Promise<void>;

  // ---- Verification

  /** GET /kyc. */
  kyc(): Promise<KycOverview>;
  /** POST /kyc (the `kyc` switch). */
  submitKyc(submission: KycSubmission): Promise<KycSubmitResult>;

  // ---- Legacy

  /** GET /legacy-plan. */
  legacyPlan(): Promise<LegacyPlanState>;
  /**
   * POST /legacy-plan with `expectedRevision`, the `revision` of the last GET (409 `conflict` when
   * it is stale).
   */
  saveLegacyPlan(body: {
    expectedRevision: number;
    plan: LegacyPlan;
  }): Promise<SaveLegacyPlanResult>;
  /** POST /legacy-plan/preview with `{ plan }`. Nothing is stored. */
  previewLegacyPlan(plan: LegacyPlan): Promise<{ projection: LegacyProjection }>;
  /** GET /beneficiaries. */
  beneficiaries(): Promise<Beneficiaries>;
  /** POST /beneficiaries. Shares may not total above 100 (409 `share_exceeds_100`). */
  addBeneficiary(body: BeneficiaryInput): Promise<BeneficiaryResult>;
  /**
   * POST /beneficiaries/update. The platform needs the `id` and the whole record (`fullName`,
   * `relationship`, `sharePercent` and an optional `dateOfBirth`), not only what changed.
   */
  updateBeneficiary(body: { id: string } & BeneficiaryInput): Promise<BeneficiaryResult>;
  /** POST /beneficiaries/remove with `{ id }`. The platform answers `{ ok: true }`. */
  removeBeneficiary(id: string): Promise<void>;

  // ---- Oracle

  /** POST /oracle/ask (the `oracle` switch). Omit `conversationId` to start a conversation. */
  oracleAsk(body: { conversationId?: string; question: string }): Promise<OracleAnswer>;
}
