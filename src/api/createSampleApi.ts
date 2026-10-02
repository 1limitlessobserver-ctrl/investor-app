// The sample PlatformApi: the platform's routes answered from an in-memory sample world
// (src/sample), for sample mode (company.config.json `platformUrl: ""`) and for every screen test.
// Each instance owns one fresh world. Every call waits `latencyMs`, so loading states are seen,
// and then answers what the platform's handler would: the same shapes, figures computed with the
// platform's own maths, the platform's codes, statuses and messages for every refusal
// (src/sample/handlers/*, one module per area of PlatformApi).
//
// Sample credentials: any email signs in with any password; an email containing "+2fa" takes the
// two-factor step, whose code is 123456; the password-gated actions take "sample".
import { MobileApiError } from './MobileApiError';
import type { PlatformApi } from './PlatformApi';
import { sampleData, type SampleState } from '../sample/sampleData';
import { createContext } from '../sample/handlers/context';
import * as account from '../sample/handlers/account';
import * as alerts from '../sample/handlers/alerts';
import * as legacy from '../sample/handlers/legacy';
import * as money from '../sample/handlers/money';
import * as oracle from '../sample/handlers/oracle';
import * as portfolio from '../sample/handlers/portfolio';
import * as support from '../sample/handlers/support';
import * as verification from '../sample/handlers/verification';

export interface SampleApiOptions {
  /** How long every call waits before it answers; 450 ms unless set. */
  latencyMs?: number;
  /** The clock the world is dated by and every answer is computed at. */
  now?: () => Date;
  /** The overflow audit's world: a 40-character company name and a $12,345,678.90 wallet. */
  stress?: boolean;
  /** What GET /brand reports as the minimum app version ("1.0.0" unless set). */
  minSupportedAppVersion?: string;
  /**
   * The session ended, as the live client's callback of that name says: told once per ended
   * session, by the first signed-in call that meets it (which still rejects `session_revoked`),
   * whatever ended it (`_test_revoke`, or this device's own revocation or account closure).
   */
  onSignedOut?: ((reason: 'session_revoked') => void) | undefined;
}

export type SampleApi = PlatformApi & {
  /**
   * Ends the session, as a revocation elsewhere would: every later call answers 401
   * `session_revoked` except the public routes (brand, login, loginTwoFactor and logout), until a
   * sign-in starts a new session. The first signed-in call to meet it tells `onSignedOut`.
   */
  _test_revoke(): void;
};

export function createSampleApi(options: SampleApiOptions = {}): SampleApi {
  const {
    latencyMs = 450,
    now = () => new Date(),
    stress = false,
    minSupportedAppVersion = '1.0.0',
    onSignedOut,
  } = options;
  const state = sampleData.createState({ now: now(), stress });
  state.brand.minSupportedAppVersion = minSupportedAppVersion;
  return createSampleApiFor(state, { latencyMs, now, onSignedOut });
}

/** The sample API over a given world; createSampleApi builds a fresh one, tests may change it first. */
export function createSampleApiFor(
  state: SampleState,
  options: Pick<SampleApiOptions, 'latencyMs' | 'now' | 'onSignedOut'> = {},
): SampleApi {
  const { latencyMs = 450, now = () => new Date(), onSignedOut } = options;
  const ctx = createContext(state, now, latencyMs);
  // Whether onSignedOut has heard of the session that ended; a sign-in starts a session afresh.
  let told = false;

  /**
   * Waits the latency, then answers as the platform would: a signed-in route of an ended session
   * is 401 `session_revoked` (the first such call tells onSignedOut); a public one always runs. The
   * public ones are the platform's (mobilePublicRoute): GET /brand, the two sign-in steps and
   * POST /auth/logout, which answers `{ ok: true }` whatever the tokens. POST /auth/refresh is
   * public there too, but a refresh of an ended session is refused with `session_revoked`, so it
   * goes through the session check here. The answer is a copy, as if it had crossed the wire, so
   * no caller holds a piece of the world.
   */
  async function answer<T>(run: () => T, access: 'signed-in' | 'public' = 'signed-in'): Promise<T> {
    await new Promise<void>((resolve) => {
      if (latencyMs > 0) setTimeout(resolve, latencyMs);
      else resolve();
    });
    if (access === 'signed-in' && ctx.session.ended) {
      if (!told) {
        told = true;
        onSignedOut?.('session_revoked');
      }
      throw new MobileApiError('session_revoked', 401, 'This session has ended. Sign in again.');
    }
    const answered = structuredClone(run());
    if (!ctx.session.ended) told = false;
    return answered;
  }

  return {
    mode: 'sample',

    login: (body) => answer(() => account.login(ctx, body), 'public'),
    loginTwoFactor: (body) => answer(() => account.loginTwoFactor(ctx, body), 'public'),
    refresh: () => answer(() => account.refresh(ctx)),
    logout: () => answer(() => account.logout(), 'public'),
    brand: () => answer(() => account.brand(ctx), 'public'),

    me: () => answer(() => account.me(ctx)),
    setNotificationPrefs: (prefs) => answer(() => account.setNotificationPrefs(ctx, prefs)),
    changePassword: (body) => answer(() => account.changePassword(ctx, body)),
    setPin: (body) => answer(() => account.setPin(ctx, body)),
    sessions: () => answer(() => account.sessions(ctx)),
    revokeSession: (sessionId) => answer(() => account.revokeSession(ctx, sessionId)),
    enrollTwoFactor: (body) => answer(() => account.enrollTwoFactor(ctx, body)),
    enableTwoFactor: (body) => answer(() => account.enableTwoFactor(ctx, body)),
    disableTwoFactor: (body) => answer(() => account.disableTwoFactor(ctx, body)),
    closeAccount: (body) => answer(() => account.closeAccount(ctx, body)),

    dashboard: () => answer(() => portfolio.dashboard(ctx)),
    investments: () => answer(() => portfolio.investments(ctx)),
    investment: (id) => answer(() => portfolio.investment(ctx, id)),
    strategies: () => answer(() => portfolio.strategies(ctx)),
    history: () => answer(() => portfolio.history(ctx)),
    statements: (kind) => answer(() => portfolio.statements(ctx, kind)),
    statement: (period) => answer(() => portfolio.statement(ctx, period)),
    statementCsv: (period) => answer(() => portfolio.statementCsv(ctx, period)),

    notifications: (limit) => answer(() => alerts.notifications(ctx, limit)),
    markRead: (id) => answer(() => alerts.markRead(ctx, id)),
    pushSubscribe: (subscription) => answer(() => alerts.pushSubscribe(ctx, subscription)),
    pushUnsubscribe: (endpoint) => answer(() => alerts.pushUnsubscribe(ctx, endpoint)),

    supportTickets: (page) => answer(() => support.supportTickets(ctx, page)),
    openTicket: (body) => answer(() => support.openTicket(ctx, body)),
    ticket: (id) => answer(() => support.ticket(ctx, id)),
    replyTicket: (body) => answer(() => support.replyTicket(ctx, body)),

    depositMethods: () => answer(() => money.depositMethods(ctx)),
    manualDeposit: (body) => answer(() => money.manualDeposit(ctx, body)),
    cardDeposit: (body) => answer(() => money.cardDeposit(ctx, body)),
    withdrawals: () => answer(() => money.withdrawals(ctx)),
    requestWithdrawal: (body) => answer(() => money.requestWithdrawal(ctx, body)),
    transfers: () => answer(() => money.transfers(ctx)),
    sendTransfer: (body) => answer(() => money.sendTransfer(ctx, body)),
    invest: (body) => answer(() => money.invest(ctx, body)),
    maturityChoice: (body) => answer(() => money.maturityChoice(ctx, body)),

    kyc: () => answer(() => verification.kyc(ctx)),
    submitKyc: (submission) => answer(() => verification.submitKyc(ctx, submission)),

    legacyPlan: () => answer(() => legacy.legacyPlan(ctx)),
    saveLegacyPlan: (body) => answer(() => legacy.saveLegacyPlan(ctx, body)),
    previewLegacyPlan: (plan) => answer(() => legacy.previewLegacyPlan(plan)),
    beneficiaries: () => answer(() => legacy.beneficiaries(ctx)),
    addBeneficiary: (body) => answer(() => legacy.addBeneficiary(ctx, body)),
    updateBeneficiary: (body) => answer(() => legacy.updateBeneficiary(ctx, body)),
    removeBeneficiary: (id) => answer(() => legacy.removeBeneficiary(ctx, id)),

    oracleAsk: (body) => answer(() => oracle.oracleAsk(ctx, body)),

    _test_revoke: () => {
      ctx.session.ended = true;
    },
  };
}
