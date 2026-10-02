// The portfolio: the dashboard, positions, strategies, history and statements. Read only: the
// actions that change them are in money.ts, which invalidates these.

import { useQuery } from '@tanstack/react-query';
import type { StatementKind } from '../api/types';
import { useAppSession } from '../session/AppSession';
import { queryKey } from './keys';

export function useDashboard() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'dashboard'), queryFn: () => api.dashboard() });
}

export function useInvestments() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'investments'), queryFn: () => api.investments() });
}

export function useInvestment(id: string) {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'investment', id),
    queryFn: () => api.investment(id),
  });
}

export function useStrategies() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'strategies'), queryFn: () => api.strategies() });
}

export function useHistory() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'history'), queryFn: () => api.history() });
}

export function useStatements(kind: StatementKind) {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'statements', kind),
    queryFn: () => api.statements(kind),
  });
}

/** One period's statement, by its key ("2026-09", "2026-Q3"). */
export function useStatement(period: string) {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'statement', period),
    queryFn: () => api.statement(period),
  });
}
