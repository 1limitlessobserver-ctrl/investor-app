// Money: deposits, withdrawals, transfers, investing and maturity choices.
//
// What each action changes, and so invalidates:
//   manualDeposit      depositOverview (the request), the dashboard (pending requests in the next
//                      steps), statements (a first dated record starts the periods), the alerts
//                      (manual_deposit_requested)
//   cardDeposit        the wallet's available balance (dashboard, transfers), history (the
//                      top-up), statements, the alerts (deposit_confirmed)
//   requestWithdrawal  withdrawals, the dashboard (pending requests); a position's also its
//                      investment (its requests and canRequestWithdrawal)
//   sendTransfer       transfers, the dashboard (the wallet), the alerts (the transfer sent)
//   invest             the dashboard, investments, strategies (capacity), transfers (the wallet),
//                      statements and every statement (the positions), the alerts
//                      (position_opened)
//   maturityChoice     REINVEST: the dashboard, investments, every investment (the matured one
//                      closes), strategies, transfers, history, every statement; WITHDRAW:
//                      investments (the choice), withdrawals (the payout filed), the dashboard

import { useQuery } from '@tanstack/react-query';
import type { PlatformApi } from '../api/PlatformApi';
import { useAppSession } from '../session/AppSession';
import { queryKey } from './keys';
import { ALERTS, useApiMutation, type Changed } from './mutation';

export function useDepositOverview() {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'depositOverview'),
    queryFn: () => api.depositMethods(),
  });
}

export function useWithdrawals() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'withdrawals'), queryFn: () => api.withdrawals() });
}

export function useTransfers() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'transfers'), queryFn: () => api.transfers() });
}

export function useManualDeposit() {
  return useApiMutation(
    (api, body: Parameters<PlatformApi['manualDeposit']>[0]) => api.manualDeposit(body),
    () => [['depositOverview'], ['dashboard'], ['statements'], ...ALERTS],
  );
}

export function useCardDeposit() {
  return useApiMutation(
    (api, body: { amountCents: number }) => api.cardDeposit(body),
    () => [['dashboard'], ['transfers'], ['history'], ['statements'], ...ALERTS],
  );
}

export function useRequestWithdrawal() {
  return useApiMutation(
    (api, body: Parameters<PlatformApi['requestWithdrawal']>[0]) => api.requestWithdrawal(body),
    (body): readonly Changed[] =>
      body.kind === 'position'
        ? [['withdrawals'], ['dashboard'], ['investment', body.investmentId]]
        : [['withdrawals'], ['dashboard']],
  );
}

export function useSendTransfer() {
  return useApiMutation(
    (api, body: Parameters<PlatformApi['sendTransfer']>[0]) => api.sendTransfer(body),
    () => [['transfers'], ['dashboard'], ...ALERTS],
  );
}

export function useInvest() {
  return useApiMutation(
    (api, body: { planId: string; amountCents: number }) => api.invest(body),
    () => [
      ['dashboard'],
      ['investments'],
      ['strategies'],
      ['transfers'],
      ['statements'],
      ['statement'],
      ...ALERTS,
    ],
  );
}

export function useMaturityChoice() {
  return useApiMutation(
    (api, body: Parameters<PlatformApi['maturityChoice']>[0]) => api.maturityChoice(body),
    (body): readonly Changed[] =>
      body.choice === 'REINVEST'
        ? [
            ['dashboard'],
            ['investments'],
            ['investment'],
            ['strategies'],
            ['transfers'],
            ['history'],
            ['statement'],
          ]
        : [['investments'], ['withdrawals'], ['dashboard']],
  );
}
