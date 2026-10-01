// Joins over the sample world's rows, shared by the statements and the sample API's handlers.
import type { PositionInput } from './portfolioMath';
import type { SamplePlan, SamplePosition, SampleState } from './sampleData';

/** The plan a position was bought in; every sample position names one of the sample plans. */
export function planOf(state: Pick<SampleState, 'plans'>, position: SamplePosition): SamplePlan {
  const plan = state.plans.find((p) => p.id === position.planId);
  if (!plan) throw new Error(`The sample position ${position.id} names no sample plan.`);
  return plan;
}

/** A position joined with its plan, as the platform's toPositionInput maps an investment row. */
export function toPositionInput(position: SamplePosition, plan: SamplePlan): PositionInput {
  return {
    id: position.id,
    planName: plan.name,
    sector: plan.sector,
    amountCents: position.amountCents,
    projectedReturnPct: plan.projectedReturnPct,
    termMonths: plan.termMonths,
    status: position.status,
    startedAt: position.startedAt,
    maturesAt: position.maturesAt,
  };
}
