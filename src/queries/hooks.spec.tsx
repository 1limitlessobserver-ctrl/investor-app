import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createSampleApi } from '../api/createSampleApi';
import type { PlatformApi } from '../api/PlatformApi';
import { AppSessionProvider, useAppSession } from '../session/AppSession';
import { fakePlatform } from '../test/fakePlatform';
import { createQueryClient } from './client';
import * as account from './account';
import * as alerts from './alerts';
import * as legacy from './legacy';
import * as money from './money';
import * as oracle from './oracle';
import * as portfolio from './portfolio';
import * as support from './support';

/** The sample api, with each method of `answers` answering its answer at once. */
function stubbedApi(answers: Partial<Record<keyof PlatformApi, unknown>>) {
  const api: Record<string, unknown> = { ...createSampleApi({ latencyMs: 0 }) };
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const [name, answer] of Object.entries(answers)) {
    calls[name] = vi.fn(() => Promise.resolve(answer));
    api[name] = calls[name];
  }
  return { api: api as unknown as PlatformApi, calls };
}

/** What the specs read of a query hook's and a mutation hook's result. */
type QueryHook = () => { data: unknown };
type MutationHook = () => { mutateAsync: (variables: unknown) => Promise<unknown> };

function setup(api: PlatformApi, platform = fakePlatform()) {
  const queryClient = createQueryClient();
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppSessionProvider api={api} platform={platform} queryClient={queryClient}>
      {children}
    </AppSessionProvider>
  );
  /** The keys invalidated so far, without the mode, sorted. */
  const keys = () =>
    invalidated.mock.calls
      .map(([filters]) => JSON.stringify((filters?.queryKey ?? []).slice(1)))
      .sort();
  return { queryClient, wrapper, keys };
}

const ALERTS = ['["dashboard"]', '["me"]', '["notifications"]'];

describe('query hooks', () => {
  it.each([
    ['useMe', () => account.useMe(), 'me', ['me']],
    ['useSessions', () => account.useSessions(), 'sessions', ['sessions']],
    ['useKyc', () => account.useKyc(), 'kyc', ['kyc']],
    ['useDashboard', () => portfolio.useDashboard(), 'dashboard', ['dashboard']],
    ['useInvestments', () => portfolio.useInvestments(), 'investments', ['investments']],
    [
      'useInvestment',
      () => portfolio.useInvestment('pos_1'),
      'investment',
      ['investment', 'pos_1'],
    ],
    ['useStrategies', () => portfolio.useStrategies(), 'strategies', ['strategies']],
    ['useHistory', () => portfolio.useHistory(), 'history', ['history']],
    [
      'useStatements',
      () => portfolio.useStatements('quarterly'),
      'statements',
      ['statements', 'quarterly'],
    ],
    [
      'useStatement',
      () => portfolio.useStatement('2026-09'),
      'statement',
      ['statement', '2026-09'],
    ],
    ['useAlerts', () => alerts.useAlerts(), 'notifications', ['notifications']],
    ['useTickets', () => support.useTickets(2), 'supportTickets', ['tickets', 2]],
    ['useTicket', () => support.useTicket('tk_1'), 'ticket', ['ticket', 'tk_1']],
    ['useDepositOverview', () => money.useDepositOverview(), 'depositMethods', ['depositOverview']],
    ['useWithdrawals', () => money.useWithdrawals(), 'withdrawals', ['withdrawals']],
    ['useTransfers', () => money.useTransfers(), 'transfers', ['transfers']],
    ['useLegacyPlan', () => legacy.useLegacyPlan(), 'legacyPlan', ['legacyPlan']],
    ['useBeneficiaries', () => legacy.useBeneficiaries(), 'beneficiaries', ['beneficiaries']],
  ] as const)(
    '%s asks the platform and keeps the answer under its key',
    async (_, hook, method, key) => {
      const answer = { from: method };
      const { api, calls } = stubbedApi({ [method]: answer });
      const { wrapper, queryClient } = setup(api);
      const { result } = renderHook(hook as QueryHook, { wrapper });
      await waitFor(() => expect(result.current.data).toEqual(answer));
      expect(queryClient.getQueryData(['sample', ...key])).toEqual(answer);
      // The key's arguments are the method's; the alerts list takes none.
      expect(calls[method]).toHaveBeenCalledWith(
        ...(method === 'notifications' ? [] : key.slice(1)),
      );
    },
  );

  it('useBrand shares the session’s brand query', async () => {
    const { wrapper } = setup(createSampleApi({ latencyMs: 0 }));
    const { result } = renderHook(() => account.useBrand(), { wrapper });
    await waitFor(() => expect(result.current.data?.name).toBe('Everest Reserve'));
  });
});

describe('mutation hooks invalidate exactly the queries they change', () => {
  const cash = { kind: 'cash', amountCents: 5_000 } as const;
  const position = { kind: 'position', investmentId: 'pos_9' } as const;
  const beneficiary = {
    fullName: 'Jordan Morgan',
    relationship: 'child',
    sharePercent: 40,
  } as const;
  const plan = { schemaVersion: 1 } as never;

  it.each([
    [
      'useSetNotificationPrefs',
      () => account.useSetNotificationPrefs(),
      'setNotificationPrefs',
      {},
      {},
      ['["me"]'],
    ],
    [
      'useChangePassword',
      () => account.useChangePassword(),
      'changePassword',
      {},
      undefined,
      ALERTS,
    ],
    ['useSetPin', () => account.useSetPin(), 'setPin', {}, undefined, ['["me"]']],
    [
      'useRevokeSession (another device)',
      () => account.useRevokeSession(),
      'revokeSession',
      'sess_2',
      { ok: true, current: false },
      ['["sessions"]'],
    ],
    ['useEnrollTwoFactor', () => account.useEnrollTwoFactor(), 'enrollTwoFactor', {}, {}, []],
    [
      'useEnableTwoFactor',
      () => account.useEnableTwoFactor(),
      'enableTwoFactor',
      {},
      {},
      ['["me"]'],
    ],
    [
      'useDisableTwoFactor',
      () => account.useDisableTwoFactor(),
      'disableTwoFactor',
      {},
      undefined,
      ['["me"]'],
    ],
    [
      'useSubmitKyc',
      () => account.useSubmitKyc(),
      'submitKyc',
      {},
      {},
      ['["dashboard"]', '["kyc"]', '["me"]', '["strategies"]'],
    ],
    ['useMarkRead', () => alerts.useMarkRead(), 'markRead', 'al_1', {}, ALERTS],
    [
      'useOpenTicket',
      () => support.useOpenTicket(),
      'openTicket',
      {},
      { id: 'tk_9' },
      ['["tickets"]'],
    ],
    [
      'useReplyTicket',
      () => support.useReplyTicket(),
      'replyTicket',
      { id: 'tk_9', message: 'Thanks' },
      undefined,
      ['["ticket","tk_9"]', '["tickets"]'],
    ],
    [
      'useManualDeposit',
      () => money.useManualDeposit(),
      'manualDeposit',
      {},
      {},
      ['["dashboard"]', '["depositOverview"]', '["me"]', '["notifications"]', '["statements"]'],
    ],
    [
      'useCardDeposit',
      () => money.useCardDeposit(),
      'cardDeposit',
      {},
      {},
      [
        '["dashboard"]',
        '["history"]',
        '["me"]',
        '["notifications"]',
        '["statements"]',
        '["transfers"]',
      ],
    ],
    [
      'useRequestWithdrawal (cash)',
      () => money.useRequestWithdrawal(),
      'requestWithdrawal',
      cash,
      {},
      ['["dashboard"]', '["withdrawals"]'],
    ],
    [
      'useRequestWithdrawal (position)',
      () => money.useRequestWithdrawal(),
      'requestWithdrawal',
      position,
      {},
      ['["dashboard"]', '["investment","pos_9"]', '["withdrawals"]'],
    ],
    [
      'useSendTransfer',
      () => money.useSendTransfer(),
      'sendTransfer',
      {},
      {},
      ['["dashboard"]', '["me"]', '["notifications"]', '["transfers"]'],
    ],
    [
      'useInvest',
      () => money.useInvest(),
      'invest',
      {},
      {},
      [
        '["dashboard"]',
        '["investments"]',
        '["me"]',
        '["notifications"]',
        '["statement"]',
        '["statements"]',
        '["strategies"]',
        '["transfers"]',
      ],
    ],
    [
      'useMaturityChoice (reinvest)',
      () => money.useMaturityChoice(),
      'maturityChoice',
      { choice: 'REINVEST', planId: 'plan_1' },
      undefined,
      [
        '["dashboard"]',
        '["history"]',
        '["investment"]',
        '["investments"]',
        '["statement"]',
        '["strategies"]',
        '["transfers"]',
      ],
    ],
    [
      'useMaturityChoice (withdraw)',
      () => money.useMaturityChoice(),
      'maturityChoice',
      { choice: 'WITHDRAW' },
      undefined,
      ['["dashboard"]', '["investments"]', '["withdrawals"]'],
    ],
    [
      'useSaveLegacyPlan',
      () => legacy.useSaveLegacyPlan(),
      'saveLegacyPlan',
      { expectedRevision: 0, plan },
      {},
      ['["dashboard"]', '["legacyPlan"]'],
    ],
    [
      'useAddBeneficiary',
      () => legacy.useAddBeneficiary(),
      'addBeneficiary',
      beneficiary,
      {},
      ['["beneficiaries"]', ...ALERTS],
    ],
    [
      'useUpdateBeneficiary',
      () => legacy.useUpdateBeneficiary(),
      'updateBeneficiary',
      { id: 'ben_1', ...beneficiary },
      {},
      ['["beneficiaries"]', ...ALERTS],
    ],
    [
      'useRemoveBeneficiary',
      () => legacy.useRemoveBeneficiary(),
      'removeBeneficiary',
      'ben_1',
      undefined,
      ['["beneficiaries"]', ...ALERTS],
    ],
    [
      'useOracleAsk',
      () => oracle.useOracleAsk(),
      'oracleAsk',
      { question: 'How am I doing?' },
      {},
      [],
    ],
  ] as const)('%s', async (_, hook, method, variables, answer, expected) => {
    const { api, calls } = stubbedApi({ [method]: answer });
    const { wrapper, keys } = setup(api);
    const { result } = renderHook(hook as MutationHook, { wrapper });
    // Each hook takes its api method's own argument.
    await result.current.mutateAsync(variables);
    expect(calls[method]).toHaveBeenCalledWith(variables);
    expect(keys()).toEqual([...expected].sort());
  });

  it.each([
    [
      'useRevokeSession (this device)',
      () => account.useRevokeSession(),
      'revokeSession',
      'sess_1',
      { ok: true, current: true },
    ],
    [
      'useCloseAccount',
      () => account.useCloseAccount(),
      'closeAccount',
      { currentPassword: 'sample' },
      undefined,
    ],
  ] as const)('%s signs this device out', async (_, hook, method, variables, answer) => {
    const { api } = stubbedApi({ [method]: answer });
    // A session from before the reload, on a device with no lock: it opens signed in.
    const { wrapper } = setup(
      api,
      fakePlatform({ lock: { enrolled: () => Promise.resolve(null) } }),
    );
    sessionStorage.setItem('app.sample', '1');
    const { result } = renderHook(
      () => ({ mutation: (hook as MutationHook)(), session: useAppSession() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.session.status).toBe('signed-in'));
    await result.current.mutation.mutateAsync(variables);
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'));
    sessionStorage.clear();
    localStorage.clear();
  });
});
