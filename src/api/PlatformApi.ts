// The one interface the screens talk to, through the hooks in src/queries. createSampleApi serves
// it from an in-memory world and createLiveApi from the platform over HTTPS (/api/mobile/v1).
//
// PlatformApi is the app's view of the platform, so several methods hand back more than the
// platform's route answers: a mutation resolves with the refreshed resource. Where that is so, the
// comment names the route, what the platform answers and what createLiveApi reads to fill the gap.
// Where a request field has another name on the wire, the comment says so too. Every method
// rejects with a MobileApiError.

import type {
  Beneficiaries,
  BeneficiaryInput,
  Brand,
  CardDepositResult,
  Dashboard,
  DepositOverview,
  DepositRequest,
  History,
  InvestmentDetail,
  Investments,
  KycOverview,
  KycSubmission,
  LegacyPlan,
  LegacyPlanState,
  LegacyProjection,
  LoginResult,
  MarkReadResult,
  Me,
  MobileTokens,
  NotificationCategory,
  NotificationList,
  OracleAnswer,
  PositionView,
  PushSubscriptionInput,
  SessionView,
  StatementDetail,
  StatementKind,
  StatementPeriods,
  Strategies,
  TicketList,
  TicketSummary,
  TicketThread,
  TransferView,
  Transfers,
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
   * stored and concurrent callers share one request.
   */
  refresh(): Promise<MobileTokens>;
  /** POST /auth/logout with the stored tokens; the platform answers `{ ok: true }` regardless. */
  logout(): Promise<void>;
  /** GET /brand. */
  brand(): Promise<Brand>;

  // ---- Account

  /** GET /me. */
  me(): Promise<Me>;
  /**
   * POST /me/notification-prefs with all seven categories. The platform answers
   * `{ notificationPrefs }`; the app gets the profile with them applied.
   */
  setNotificationPrefs(prefs: Record<NotificationCategory, boolean>): Promise<Me>;
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
   * POST /support/tickets with `{ subject, body }`; `message` here is the platform's `body`. The
   * platform answers `{ id }`; the app gets that ticket's summary. Obeys the `support` switch.
   */
  openTicket(body: { subject: string; message: string }): Promise<TicketSummary>;
  /** GET /support/ticket?id=. */
  ticket(id: string): Promise<TicketThread>;
  /**
   * POST /support/reply with `{ ticketId, body }`; `id` and `message` here are the platform's
   * `ticketId` and `body`. The platform answers `{ ok: true }`; the app gets the updated thread. It
   * works with the `support` switch off.
   */
  replyTicket(body: { id: string; message: string }): Promise<TicketThread>;

  // ---- Money

  /** GET /deposit/methods (the `deposits` switch). */
  depositMethods(): Promise<DepositOverview>;
  /**
   * POST /deposit/manual (the `deposits` switch). The platform answers `{ id, amountCents,
   * methodLabel, address, status: 'PENDING' }`; the app gets the request as GET /deposit/methods
   * lists it.
   */
  manualDeposit(body: {
    methodId: string;
    amountCents: number;
    reference?: string;
  }): Promise<DepositRequest>;
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
  /**
   * POST /transfers. The platform answers `{ id, amountCents, currency, status }`; the app gets the
   * transfer as GET /transfers lists it. `recipient` is an email or a $tag; `currency` is USD when
   * left out.
   */
  sendTransfer(body: {
    recipient: string;
    amountCents: number;
    currency?: string;
    note?: string;
    pin: string;
  }): Promise<TransferView>;
  /**
   * POST /invest, paid from the available wallet balance. The platform answers `{ kind: 'wallet',
   * orderId, url: null }`; the app gets the position it opened, the newest in GET /investments.
   */
  invest(body: { planId: string; amountCents: number }): Promise<PositionView>;
  /**
   * POST /maturity-choice. Without `choiceId` it takes the earliest pending choice, and REINVEST
   * needs a `planId`. The platform answers `{ ok: true }`; the app gets GET /investments.
   */
  maturityChoice(body: {
    choiceId?: string;
    choice: 'REINVEST' | 'WITHDRAW';
    planId?: string;
  }): Promise<Investments>;

  // ---- Verification

  /** GET /kyc. */
  kyc(): Promise<KycOverview>;
  /**
   * POST /kyc (the `kyc` switch). The platform answers `{ submissionId, status: 'PENDING' }`; the
   * app gets GET /kyc.
   */
  submitKyc(submission: KycSubmission): Promise<KycOverview>;

  // ---- Legacy

  /** GET /legacy-plan. */
  legacyPlan(): Promise<LegacyPlanState>;
  /**
   * POST /legacy-plan with `expectedRevision`, the `revision` of the last GET (409 `conflict` when
   * it is stale). The platform answers `{ revision, revisionId, message }`; the app gets
   * GET /legacy-plan.
   */
  saveLegacyPlan(body: { expectedRevision: number; plan: LegacyPlan }): Promise<LegacyPlanState>;
  /** POST /legacy-plan/preview with `{ plan }`. Nothing is stored. */
  previewLegacyPlan(plan: LegacyPlan): Promise<{ projection: LegacyProjection }>;
  /** GET /beneficiaries. */
  beneficiaries(): Promise<Beneficiaries>;
  /**
   * POST /beneficiaries. The platform answers `{ beneficiary }`; the app gets GET /beneficiaries.
   * Shares may not total above 100 (409 `share_exceeds_100`).
   */
  addBeneficiary(body: BeneficiaryInput): Promise<Beneficiaries>;
  /**
   * POST /beneficiaries/update. The platform needs `fullName`, `relationship` and `sharePercent` as
   * well as the `id`, so what `body` leaves out is filled from the current record. It answers
   * `{ beneficiary }`; the app gets GET /beneficiaries.
   */
  updateBeneficiary(body: { id: string } & Partial<BeneficiaryInput>): Promise<Beneficiaries>;
  /**
   * POST /beneficiaries/remove with `{ id }`. The platform answers `{ ok: true }`; the app gets
   * GET /beneficiaries.
   */
  removeBeneficiary(id: string): Promise<Beneficiaries>;

  // ---- Oracle

  /** POST /oracle/ask (the `oracle` switch). Omit `conversationId` to start a conversation. */
  oracleAsk(body: { conversationId?: string; question: string }): Promise<OracleAnswer>;
}
