// Every query's key: [mode, name, ...args]. The mode keeps the sample world's answers apart from
// the platform's, and a key of the name alone matches every argument of it, which is how a
// mutation invalidates, say, every page of the tickets.

import type { PlatformApi } from '../api/PlatformApi';

export type Mode = PlatformApi['mode'];

export type QueryName =
  | 'brand'
  | 'me'
  | 'sessions'
  | 'kyc'
  | 'dashboard'
  | 'investments'
  | 'investment'
  | 'strategies'
  | 'history'
  | 'statements'
  | 'statement'
  | 'notifications'
  | 'tickets'
  | 'ticket'
  | 'depositOverview'
  | 'withdrawals'
  | 'transfers'
  | 'legacyPlan'
  | 'beneficiaries';

export function queryKey(mode: Mode, name: QueryName, ...args: readonly (string | number)[]) {
  return [mode, name, ...args] as const;
}
