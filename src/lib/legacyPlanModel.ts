// The Legacy plan: a line-for-line port of the platform's src/lib/legacy-plan/model.ts, so the app
// projects a scenario exactly as the website does, on every slider move and without the network.
// The strict zod schema is the platform's, as is; the maths is BigInt fixed point with the same
// half-away-from-zero rounding and the same range error. A fixed-assumption illustration only:
// never connected to balances, fees or payouts.
//
// Not ported: legacyResearchBrief(), the platform's Oracle context (server only). Added for the
// screens: LEGACY_RANGE_ERROR (the error text, the platform's literal) and `legacyPlanModel`.
import { z } from 'zod';
import type { LegacyFocus, LegacyPlan, LegacyProjection } from '../api/types';

export const LEGACY_FOCUSES = ['freedom', 'family', 'resilience', 'impact'] as const;
export const FOCUS_COPY = {
  freedom: { title: 'More freedom', description: 'Create room for a life you choose.', glyph: '↗' },
  family: {
    title: 'Family continuity',
    description: 'Make the next chapter a shared one.',
    glyph: '◇',
  },
  resilience: {
    title: 'Greater resilience',
    description: 'Protect your ability to choose tomorrow.',
    glyph: '◎',
  },
  impact: {
    title: 'Lasting impact',
    description: 'Give your resources a purpose beyond you.',
    glyph: '✦',
  },
} as const;
const cents = z.number().safe().int().min(0).max(100_000_000_000);
export const LegacyPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: z.literal('USD'),
    title: z.string().trim().min(3).max(80),
    focus: z.enum(LEGACY_FOCUSES),
    purpose: z.string().trim().min(10).max(800),
    horizonYears: z.number().int().min(1).max(50),
    startingCapitalCents: cents,
    monthlyContributionCents: cents.max(100_000_000),
    monthlyIncomeGoalCents: cents.max(100_000_000),
    monthlySpendingCents: cents.max(100_000_000),
    reserveMonths: z.number().int().min(1).max(36),
    annualReturnBps: z.number().int().min(-3000).max(3000),
    annualFeeBps: z.number().int().min(0).max(1000),
    inflationBps: z.number().int().min(0).max(2000),
    annualDrawBps: z.number().int().min(0).max(2000),
    reviewCadence: z.enum(['monthly', 'quarterly', 'annually']),
    futureLetter: z.string().trim().max(2000),
    commitments: z
      .object({
        reviewBudget: z.boolean(),
        documentLiquidity: z.boolean(),
        challengeAssumptions: z.boolean(),
        discussContinuity: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const DEFAULT_LEGACY_PLAN: LegacyPlan = {
  schemaVersion: 1,
  currency: 'USD',
  title: 'The life I am building',
  focus: 'freedom',
  purpose:
    'Build the freedom to spend more time on what matters, with a clear record of every assumption.',
  horizonYears: 20,
  startingCapitalCents: 2500000,
  monthlyContributionCents: 100000,
  monthlyIncomeGoalCents: 200000,
  monthlySpendingCents: 250000,
  reserveMonths: 6,
  annualReturnBps: 0,
  annualFeeBps: 0,
  inflationBps: 250,
  annualDrawBps: 400,
  reviewCadence: 'quarterly',
  futureLetter: '',
  commitments: {
    reviewBudget: false,
    documentLiquidity: false,
    challengeAssumptions: false,
    discussContinuity: false,
  },
};
/** What a scenario that overflows a safe integer throws; the platform answers it as invalid_input. */
export const LEGACY_RANGE_ERROR =
  'This scenario exceeds the supported range. Reduce the amount, rate or horizon.';
const FIXED = 1_000_000_000_000n;
const round = (n: bigint, d: bigint) => (n < 0n ? -((-n + d / 2n) / d) : (n + d / 2n) / d);
function exact(n: bigint) {
  const result = Number(n);
  if (!Number.isSafeInteger(result)) throw new Error(LEGACY_RANGE_ERROR);
  return result;
}

/** Fixed-assumption illustration only. Never connected to balances, fees or payouts. */
export function projectLegacyPlan(raw: unknown): LegacyProjection {
  const plan = LegacyPlanSchema.parse(raw);
  let balance = BigInt(plan.startingCapitalCents);
  let contributions = balance;
  let fees = 0n;
  let gains = 0n;
  let inflationIndex = FIXED;
  const points = [
    {
      year: 0,
      nominalCents: exact(balance),
      realCents: exact(balance),
      contributionCents: exact(contributions),
    },
  ];
  for (let month = 1; month <= plan.horizonYears * 12; month++) {
    const gain = round(balance * BigInt(plan.annualReturnBps), 120000n);
    const fee = round(balance * BigInt(plan.annualFeeBps), 120000n);
    balance += gain - fee + BigInt(plan.monthlyContributionCents);
    contributions += BigInt(plan.monthlyContributionCents);
    fees += fee;
    gains += gain;
    inflationIndex += round(inflationIndex * BigInt(plan.inflationBps), 120000n);
    exact(balance);
    if (month % 12 === 0)
      points.push({
        year: month / 12,
        nominalCents: exact(balance),
        realCents: exact(round(balance * FIXED, inflationIndex)),
        contributionCents: exact(contributions),
      });
  }
  const futureIncomeGoal = round(BigInt(plan.monthlyIncomeGoalCents) * inflationIndex, FIXED);
  const targetCapital =
    plan.annualDrawBps > 0
      ? (futureIncomeGoal * 120000n + BigInt(plan.annualDrawBps) - 1n) / BigInt(plan.annualDrawBps)
      : null;
  const monthlyDraw = round(balance * BigInt(plan.annualDrawBps), 120000n);
  return {
    classification: 'PERSONAL_PLANNING_SCENARIO' as const,
    points,
    endingCapitalCents: exact(balance),
    realCapitalCents: exact(round(balance * FIXED, inflationIndex)),
    plannedContributionsCents: exact(contributions),
    modelledGainsCents: exact(gains),
    modelledFeesCents: exact(fees),
    reserveGoalCents: exact(BigInt(plan.monthlySpendingCents) * BigInt(plan.reserveMonths)),
    futureMonthlyIncomeGoalCents: exact(futureIncomeGoal),
    targetCapitalCents: targetCapital === null ? null : exact(targetCapital),
    modelledMonthlyDrawCents: exact(monthlyDraw),
    realMonthlyDrawCents: exact(round(monthlyDraw * FIXED, inflationIndex)),
    coveragePercent:
      targetCapital && targetCapital > 0n
        ? Math.min(999, Number((balance * 1000n) / targetCapital) / 10)
        : null,
    completedCommitments: Object.values(plan.commitments).filter(Boolean).length,
  };
}

export interface LegacyFocusOption {
  id: LegacyFocus;
  /** The platform's title for the focus, such as "More freedom". */
  label: string;
  description: string;
  glyph: string;
}

export const legacyPlanModel: {
  defaultPlan: LegacyPlan;
  focuses: readonly LegacyFocusOption[];
  rangeError: string;
  /** Validates the plan with the platform's schema (a ZodError when it fails), then projects it. */
  project(plan: LegacyPlan): LegacyProjection;
} = {
  defaultPlan: DEFAULT_LEGACY_PLAN,
  focuses: LEGACY_FOCUSES.map((id) => ({
    id,
    label: FOCUS_COPY[id].title,
    description: FOCUS_COPY[id].description,
    glyph: FOCUS_COPY[id].glyph,
  })),
  rangeError: LEGACY_RANGE_ERROR,
  project: (plan) => projectLegacyPlan(plan),
};
