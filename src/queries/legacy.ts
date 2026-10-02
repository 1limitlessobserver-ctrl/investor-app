// Legacy: the plan and its beneficiaries.
//
// What each action changes, and so invalidates:
//   saveLegacyPlan       legacyPlan (the revision and its history), the dashboard (the next steps)
//   add/update/removeBeneficiary
//                        beneficiaries, the alerts (beneficiary_updated)
// previewLegacyPlan changes nothing: screens call api.previewLegacyPlan directly.

import { useQuery } from '@tanstack/react-query';
import type { BeneficiaryInput, LegacyPlan } from '../api/types';
import { useAppSession } from '../session/AppSession';
import { queryKey } from './keys';
import { ALERTS, useApiMutation } from './mutation';

export function useLegacyPlan() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'legacyPlan'), queryFn: () => api.legacyPlan() });
}

export function useBeneficiaries() {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'beneficiaries'),
    queryFn: () => api.beneficiaries(),
  });
}

export function useSaveLegacyPlan() {
  return useApiMutation(
    (api, body: { expectedRevision: number; plan: LegacyPlan }) => api.saveLegacyPlan(body),
    () => [['legacyPlan'], ['dashboard']],
  );
}

export function useAddBeneficiary() {
  return useApiMutation(
    (api, body: BeneficiaryInput) => api.addBeneficiary(body),
    () => [['beneficiaries'], ...ALERTS],
  );
}

export function useUpdateBeneficiary() {
  return useApiMutation(
    (api, body: { id: string } & BeneficiaryInput) => api.updateBeneficiary(body),
    () => [['beneficiaries'], ...ALERTS],
  );
}

export function useRemoveBeneficiary() {
  return useApiMutation(
    (api, id: string) => api.removeBeneficiary(id),
    () => [['beneficiaries'], ...ALERTS],
  );
}
