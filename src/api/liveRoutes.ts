// The wire side of every PlatformApi method of the live client: its route (HTTP method and path),
// whether it goes out without the bearer, what it resolves, and the request field names the
// platform spells differently for the ticket calls. No network and no store here.

import type { PlatformApi } from './PlatformApi';

/** The name of a PlatformApi method (`mode` is not one). */
export type ApiMethod = Exclude<keyof PlatformApi, 'mode'>;
/** A method's HTTP method, and its path under `baseUrl` without a query string. */
export type Route = { readonly method: 'GET' | 'POST'; readonly path: `/${string}` };

/** What a method resolves. */
export type Answer<K extends ApiMethod> = Awaited<ReturnType<PlatformApi[K]>>;
/** The methods that resolve nothing, the one that resolves text, and the rest, which read JSON. */
export type VoidMethod = { [K in ApiMethod]: Answer<K> extends void ? K : never }[ApiMethod];
export type TextMethod = { [K in ApiMethod]: Answer<K> extends string ? K : never }[ApiMethod];
export type JsonMethod = Exclude<ApiMethod, VoidMethod | TextMethod>;

/** The methods whose route never carries the bearer; every other route does, logout included. */
export const PUBLIC_ROUTES = [
  'brand',
  'login',
  'loginTwoFactor',
  'refresh',
] as const satisfies readonly ApiMethod[];
/** Whether a method's route goes out without the bearer. */
export const isPublic = (name: ApiMethod): boolean =>
  (PUBLIC_ROUTES as readonly ApiMethod[]).includes(name);

/**
 * The route of every PlatformApi method: its HTTP method and its path under `baseUrl`, without a
 * query string. These methods add a query key: investment (id), statements (kind), statement and
 * statementCsv (period), notifications (limit), supportTickets (page), ticket (id). The wire spec
 * checks it against the platform's routes. `push/subscribe` and `push/unsubscribe` are the app's
 * own: the platform has no such routes yet.
 */
export const ROUTES = {
  login: { method: 'POST', path: '/auth/login' },
  loginTwoFactor: { method: 'POST', path: '/auth/login/2fa' },
  refresh: { method: 'POST', path: '/auth/refresh' },
  logout: { method: 'POST', path: '/auth/logout' },
  brand: { method: 'GET', path: '/brand' },

  me: { method: 'GET', path: '/me' },
  setNotificationPrefs: { method: 'POST', path: '/me/notification-prefs' },
  changePassword: { method: 'POST', path: '/me/password' },
  setPin: { method: 'POST', path: '/me/pin' },
  sessions: { method: 'GET', path: '/me/sessions' },
  revokeSession: { method: 'POST', path: '/me/sessions/revoke' },
  enrollTwoFactor: { method: 'POST', path: '/me/two-factor/enroll' },
  enableTwoFactor: { method: 'POST', path: '/me/two-factor/enable' },
  disableTwoFactor: { method: 'POST', path: '/me/two-factor/disable' },
  closeAccount: { method: 'POST', path: '/me/close' },

  dashboard: { method: 'GET', path: '/dashboard' },
  investments: { method: 'GET', path: '/investments' },
  investment: { method: 'GET', path: '/investments/detail' },
  strategies: { method: 'GET', path: '/strategies' },
  history: { method: 'GET', path: '/history' },
  statements: { method: 'GET', path: '/statements' },
  statement: { method: 'GET', path: '/statements/detail' },
  statementCsv: { method: 'GET', path: '/statements/file' },

  notifications: { method: 'GET', path: '/notifications' },
  markRead: { method: 'POST', path: '/notifications/read' },
  pushSubscribe: { method: 'POST', path: '/push/subscribe' },
  pushUnsubscribe: { method: 'POST', path: '/push/unsubscribe' },

  supportTickets: { method: 'GET', path: '/support/tickets' },
  openTicket: { method: 'POST', path: '/support/tickets' },
  ticket: { method: 'GET', path: '/support/ticket' },
  replyTicket: { method: 'POST', path: '/support/reply' },

  depositMethods: { method: 'GET', path: '/deposit/methods' },
  manualDeposit: { method: 'POST', path: '/deposit/manual' },
  cardDeposit: { method: 'POST', path: '/deposit/checkout' },
  withdrawals: { method: 'GET', path: '/withdrawals' },
  requestWithdrawal: { method: 'POST', path: '/withdrawals' },
  transfers: { method: 'GET', path: '/transfers' },
  sendTransfer: { method: 'POST', path: '/transfers' },
  invest: { method: 'POST', path: '/invest' },
  maturityChoice: { method: 'POST', path: '/maturity-choice' },

  kyc: { method: 'GET', path: '/kyc' },
  submitKyc: { method: 'POST', path: '/kyc' },

  legacyPlan: { method: 'GET', path: '/legacy-plan' },
  saveLegacyPlan: { method: 'POST', path: '/legacy-plan' },
  previewLegacyPlan: { method: 'POST', path: '/legacy-plan/preview' },
  beneficiaries: { method: 'GET', path: '/beneficiaries' },
  addBeneficiary: { method: 'POST', path: '/beneficiaries' },
  updateBeneficiary: { method: 'POST', path: '/beneficiaries/update' },
  removeBeneficiary: { method: 'POST', path: '/beneficiaries/remove' },

  oracleAsk: { method: 'POST', path: '/oracle/ask' },
} as const satisfies Readonly<Record<ApiMethod, Route>>;

// openTicket and replyTicket: the platform keys their fields `body` and `ticketId`; PlatformApi
// (and so the sample and the forms) calls them `message` and `id`.
type FieldOf<K extends ApiMethod> = keyof Parameters<PlatformApi[K]>[0] & string;
export const OPEN_TICKET_FIELDS: ReadonlyMap<string, FieldOf<'openTicket'>> = new Map([
  ['body', 'message'],
]);
export const REPLY_TICKET_FIELDS: ReadonlyMap<string, FieldOf<'replyTicket'>> = new Map([
  ['body', 'message'],
  ['ticketId', 'id'],
]);
