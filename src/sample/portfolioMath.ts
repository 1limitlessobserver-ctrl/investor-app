// The platform's portfolio maths, ported line for line so the sample world's figures are the ones
// the platform computes from the same rows (portfolioMath.spec.ts pins them to the platform's own
// output for the sample rows, __fixtures__/expected.json):
//   - src/lib/investments/lifecycle.ts: computeEarnings, getUserAggregates, buildLiveKpis;
//   - src/lib/mobile/portfolio.ts: positionView, allocationBySector, projectionSeries, nextSteps.
// Same names and arguments, pure functions over rows. Every figure is a plan projection (principal
// plus time-weighted accrual at the plan's configured rate), never market data.
//
// Differences, all at the database boundary:
//   - getUserAggregates(userId, now) reads the investor's ACTIVE and MATURED positions from the
//     database. Its pure core here takes the investor's rows instead, keeps that status filter, and
//     reads cents and the rate from PositionInput (the platform converts Prisma Decimals with
//     toCents and Number), exactly as gen/generate.ts computed the expected aggregates.
//   - Not ported: realizeDueMaturities and aggregateEarningsByUser (database writes and the
//     leaderboard), decimalToCents (the sample world is in cents already).
//   - `Kpi` comes from src/lib/data/portfolio.ts, which is not staged; it is written out here from
//     what buildLiveKpis builds and what GET /dashboard reads from it.
import type { DashboardKpi, NextStep } from '../api/types';

// ---- src/lib/investments/lifecycle.ts --------------------------------------------------------

export interface EarningsResult {
  /** Principal in cents. */
  principalCents: number;
  /** Full-term projected return in cents = principal × (annualizedPct/100) × (termMonths/12). */
  termReturnCents: number;
  /** Accrued earnings so far in cents (== termReturnCents when MATURED). */
  accruedCents: number;
  /** Legacy field: projected term earnings when MATURED, not reconciled realized P&L. */
  realizedCents: number;
  /** True when the investment has matured. */
  isRealized: boolean;
}

export interface EarningsInput {
  amountCents: number;
  /** Annualized projected return, e.g. 8.5 means 8.5%/yr. */
  projectedReturnPct: number;
  termMonths: number;
  startedAt: Date;
  maturesAt: Date;
  status: string;
  now: Date;
}

/**
 * Compute time-weighted accrued + realized earnings for a single investment.
 * For ACTIVE: accrue `termReturn × fraction`, fraction = elapsed/term clamped
 * to [0,1]. For MATURED: the full `termReturn` is realized. A zero-length term
 * yields 0 accrual (degenerate but safe).
 */
export function computeEarnings(input: EarningsInput): EarningsResult {
  const termYears = input.termMonths / 12;
  const termReturnCents = Math.round(
    input.amountCents * (input.projectedReturnPct / 100) * termYears,
  );
  const isRealized = input.status === 'MATURED';

  if (isRealized) {
    return {
      principalCents: input.amountCents,
      termReturnCents,
      accruedCents: termReturnCents,
      realizedCents: termReturnCents,
      isRealized: true,
    };
  }

  const totalMs = input.maturesAt.getTime() - input.startedAt.getTime();
  let fraction = 0;
  if (totalMs > 0) {
    const elapsed = input.now.getTime() - input.startedAt.getTime();
    fraction = Math.min(Math.max(elapsed / totalMs, 0), 1);
  }
  const accruedCents = Math.round(termReturnCents * fraction);
  return {
    principalCents: input.amountCents,
    termReturnCents,
    accruedCents,
    realizedCents: 0,
    isRealized: false,
  };
}

export interface UserAggregates {
  deployedCents: number;
  portfolioValueCents: number; // deployed + earnings
  earningsCents: number; // accrued + realized
  projectedYieldPct: number; // blended annualized, weighted by deployed
  positionCount: number;
  activeCount: number;
  maturedCount: number;
}

const ZERO_AGGREGATES: UserAggregates = {
  deployedCents: 0,
  portfolioValueCents: 0,
  earningsCents: 0,
  projectedYieldPct: 0,
  positionCount: 0,
  activeCount: 0,
  maturedCount: 0,
};

/**
 * Aggregate a single user's ACTIVE/MATURED positions into live KPI inputs.
 * `portfolioValue = deployed + earnings`. `projectedYield` is the deployed-
 * weighted blend of each plan's annualized projectedReturn.
 */
export function getUserAggregates(
  positions: PositionInput[],
  now: Date = new Date(),
): UserAggregates {
  // The platform's query: where: { userId, status: { in: ['ACTIVE', 'MATURED'] } }.
  const rows = positions.filter((inv) => inv.status === 'ACTIVE' || inv.status === 'MATURED');
  if (rows.length === 0) return { ...ZERO_AGGREGATES };

  let deployedCents = 0;
  let earningsCents = 0;
  let activeCount = 0;
  let maturedCount = 0;
  let yieldWeighted = 0;

  for (const inv of rows) {
    if (!inv.startedAt || !inv.maturesAt) continue;
    const amountCents = inv.amountCents;
    const pct = inv.projectedReturnPct;
    const e = computeEarnings({
      amountCents,
      projectedReturnPct: pct,
      termMonths: inv.termMonths,
      startedAt: inv.startedAt,
      maturesAt: inv.maturesAt,
      status: inv.status,
      now,
    });
    deployedCents += amountCents;
    earningsCents += e.accruedCents;
    yieldWeighted += pct * amountCents;
    if (inv.status === 'MATURED') maturedCount++;
    else activeCount++;
  }

  return {
    deployedCents,
    portfolioValueCents: deployedCents + earningsCents,
    earningsCents,
    projectedYieldPct: deployedCents > 0 ? yieldWeighted / deployedCents : 0,
    positionCount: activeCount + maturedCount,
    activeCount,
    maturedCount,
  };
}

function centsToUsd(cents: number): string {
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

/** One of the dashboard's figures, as src/lib/data/portfolio.ts types it. */
export interface Kpi {
  label: string;
  value: string;
  deltaPct: number;
  spark: number[];
  basis?: DashboardKpi['basis'];
  hint: string;
}

/**
 * Present legacy plan projections with explicit provenance. The historical
 * function name is retained for callers; these are not marked market values.
 * No history is available, so delta badges and synthetic sparklines are omitted.
 */
export function buildLiveKpis(a: UserAggregates, rank: number | null): Kpi[] {
  const yieldPct = Math.round(a.projectedYieldPct * 10) / 10;
  return [
    {
      label: 'Projected Portfolio',
      value: centsToUsd(a.portfolioValueCents),
      deltaPct: 0,
      spark: [],
      basis: 'projection',
      hint: `${a.positionCount} recorded position${a.positionCount === 1 ? '' : 's'} · principal + estimate`,
    },
    {
      label: 'Estimated Earnings',
      value: centsToUsd(a.earningsCents),
      deltaPct: 0,
      spark: [],
      basis: 'projection',
      hint: 'Plan-rate estimate · not realized profit',
    },
    {
      label: 'Projected Yield',
      value: `${yieldPct}%`,
      deltaPct: 0,
      spark: [],
      basis: 'projection',
      hint: 'Configured plan rates · annualized',
    },
    {
      label: 'Projection-based Rank',
      value: rank ? `#${rank.toLocaleString('en-US')}` : '—',
      deltaPct: 0,
      spark: [],
      basis: 'projection',
      hint: 'Estimate-based ranking · not measured performance',
    },
  ];
}

// ---- src/lib/mobile/portfolio.ts -------------------------------------------------------------

export interface PositionInput {
  id: string;
  planName: string;
  sector: string | null;
  amountCents: number;
  /** Annualised plan rate, e.g. 12 for 12% a year. */
  projectedReturnPct: number;
  termMonths: number;
  status: string;
  startedAt: Date | null;
  maturesAt: Date | null;
}

const COMPLETE = new Set(['MATURED', 'WITHDRAWN']);

export function positionView(p: PositionInput, now: Date) {
  if (!p.startedAt || !p.maturesAt) {
    return {
      principalCents: p.amountCents,
      accruedCents: 0,
      termReturnCents: 0,
      valueCents: p.amountCents,
      progressPct: COMPLETE.has(p.status) ? 100 : 0,
    };
  }
  const complete = COMPLETE.has(p.status);
  const earnings = computeEarnings({
    amountCents: p.amountCents,
    projectedReturnPct: p.projectedReturnPct,
    termMonths: p.termMonths,
    startedAt: p.startedAt,
    maturesAt: p.maturesAt,
    status: complete ? 'MATURED' : 'ACTIVE',
    now,
  });
  const total = p.maturesAt.getTime() - p.startedAt.getTime();
  const fraction = complete
    ? 1
    : total > 0
      ? Math.min(Math.max((now.getTime() - p.startedAt.getTime()) / total, 0), 1)
      : 0;
  return {
    principalCents: p.amountCents,
    accruedCents: earnings.accruedCents,
    termReturnCents: earnings.termReturnCents,
    valueCents: p.amountCents + earnings.accruedCents,
    progressPct: Math.round(fraction * 1000) / 10,
  };
}

export function allocationBySector(
  positions: PositionInput[],
): Array<{ label: string; valueCents: number; weightPct: number }> {
  const bySector = new Map<string, number>();
  for (const p of positions) {
    const label = p.sector?.trim() || p.planName;
    bySector.set(label, (bySector.get(label) ?? 0) + p.amountCents);
  }
  const total = [...bySector.values()].reduce((sum, v) => sum + v, 0);
  if (total <= 0) return [];
  return [...bySector.entries()]
    .map(([label, valueCents]) => ({
      label,
      valueCents,
      weightPct: Math.round((valueCents / total) * 1000) / 10,
    }))
    .sort((a, b) => b.valueCents - a.valueCents || a.label.localeCompare(b.label));
}

/**
 * The projected value path from the first position's start to the last maturity
 * (or now, if later), evenly sampled. Each point counts the positions started by
 * then at principal plus accrual at that instant.
 */
export function projectionSeries(
  positions: PositionInput[],
  now: Date,
  maxPoints = 24,
): Array<{ date: string; valueCents: number }> {
  const dated = positions.filter(
    (p): p is PositionInput & { startedAt: Date; maturesAt: Date } =>
      p.startedAt !== null && p.maturesAt !== null,
  );
  if (dated.length === 0) return [];
  const start = Math.min(...dated.map((p) => p.startedAt.getTime()));
  const end = Math.max(now.getTime(), ...dated.map((p) => p.maturesAt.getTime()));
  const count = end > start ? Math.max(2, maxPoints) : 1;
  const points: Array<{ date: string; valueCents: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(count === 1 ? start : Math.round(start + ((end - start) * i) / (count - 1)));
    let valueCents = 0;
    for (const p of dated) {
      if (p.startedAt.getTime() > t.getTime()) continue;
      valueCents +=
        p.amountCents +
        computeEarnings({
          amountCents: p.amountCents,
          projectedReturnPct: p.projectedReturnPct,
          termMonths: p.termMonths,
          startedAt: p.startedAt,
          maturesAt: p.maturesAt,
          status: 'ACTIVE',
          now: t,
        }).accruedCents;
    }
    points.push({ date: t.toISOString(), valueCents });
  }
  return points;
}

export interface NextStepsInput {
  kycRequired: boolean;
  kycStatus: string;
  hasLegacyPlan: boolean;
  pendingChoices: number;
  pendingRequests: number;
  positionCount: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function nextSteps(i: NextStepsInput): NextStep[] {
  const steps: NextStep[] = [];
  if (i.kycRequired && i.kycStatus === 'PENDING') {
    steps.push({
      id: 'kyc_pending',
      title: 'Identity review in progress',
      detail: 'You will get an alert as soon as a reviewer decides.',
      target: 'kyc',
    });
  } else if (i.kycRequired && i.kycStatus !== 'APPROVED') {
    steps.push({
      id: 'verify_identity',
      title: i.kycStatus === 'NONE' ? 'Verify your identity' : 'Update your identity verification',
      detail: 'Verification is required before you can invest.',
      target: 'kyc',
    });
  }
  if (i.pendingChoices > 0) {
    steps.push({
      id: 'maturity_choice',
      title: 'Choose what happens to matured capital',
      detail: `${plural(i.pendingChoices, 'position')} waiting for your decision.`,
      target: 'maturity',
    });
  }
  if (i.pendingRequests > 0) {
    steps.push({
      id: 'pending_requests',
      title: `${plural(i.pendingRequests, 'request')} under review`,
      detail: 'Deposits and withdrawals awaiting an administrator.',
      target: 'activity',
    });
  }
  if (!i.hasLegacyPlan) {
    steps.push({
      id: 'legacy_plan',
      title: 'Design your legacy plan',
      detail: 'Give your goals a purpose, a horizon and a plan.',
      target: 'legacy',
    });
  }
  if (i.positionCount === 0) {
    steps.push({
      id: 'first_investment',
      title: 'Make your first investment',
      detail: 'Browse the strategies open to your tier.',
      target: 'invest',
    });
  }
  return steps;
}

export const portfolioMath = {
  positionView,
  allocationBySector,
  projectionSeries,
  nextSteps,
  computeEarnings,
  getUserAggregates,
  buildLiveKpis,
};
