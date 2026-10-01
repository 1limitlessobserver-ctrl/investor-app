// The portfolio routes (dashboard, investments, investments/detail, strategies, history,
// statements*), composed from the sample rows as the platform's handlers compose them from the
// database, with the platform's own maths (portfolioMath). The dashboard does not mature due
// positions on read (realizeDueMaturities): the sample world's dates are set when it is created.
import type {
  Dashboard,
  History,
  InvestmentDetail,
  Investments,
  StatementDetail,
  StatementKind,
  StatementPeriods,
  Strategies,
} from '../../api/types';
import {
  allocationBySector,
  buildLiveKpis,
  getUserAggregates,
  nextSteps,
  projectionSeries,
} from '../portfolioMath';
import { planOf } from '../rows';
import { sampleStatements, type StatementPeriodRange } from '../sampleStatements';
import type { SampleContext } from './context';
import { fail, requireQuery } from './context';
import {
  alertView,
  capacityFor,
  cashBalance,
  iso,
  isoOrNull,
  meetsTier,
  minimumOf,
  newestAlerts,
  openPositionInputs,
  positionDto,
  tierView,
  unreadCount,
} from './views';

/** A position withdrawal in one of these statuses blocks another request for it. */
const IN_FLIGHT = new Set(['PENDING', 'APPROVED', 'PAID']);
const POSITIONS_LISTED = 200;

export function dashboard(ctx: SampleContext): Dashboard {
  const { state } = ctx;
  const now = ctx.now();
  const positions = openPositionInputs(state);
  const aggregates = getUserAggregates(positions, now);
  const pending = <T extends { status: string }>(rows: T[]) =>
    rows.filter((r) => r.status === 'PENDING').length;
  return {
    asOf: iso(now),
    user: {
      firstName: state.user.fullName.split(' ')[0] || state.user.fullName,
      tier: tierView(state.user.tier),
      kycStatus: state.kyc.status,
    },
    totals: {
      basis: 'projection',
      deployedCents: aggregates.deployedCents,
      portfolioValueCents: aggregates.portfolioValueCents,
      earningsCents: aggregates.earningsCents,
      projectedYieldPct: Math.round(aggregates.projectedYieldPct * 10) / 10,
      positionCount: aggregates.positionCount,
      activeCount: aggregates.activeCount,
      maturedCount: aggregates.maturedCount,
    },
    cash: {
      balanceCents: cashBalance(state),
      wallets: state.wallets.map((w) => ({
        currency: w.currency,
        availableCents: w.availableCents,
        lockedCents: w.lockedCents,
      })),
    },
    kpis: buildLiveKpis(aggregates, state.rank).map((k) => ({
      label: k.label,
      value: k.value,
      hint: k.hint,
      basis: k.basis ?? 'projection',
    })),
    allocation: allocationBySector(positions),
    performance: { basis: 'projection', points: projectionSeries(positions, now) },
    nextSteps: nextSteps({
      kycRequired: state.brand.features.kyc,
      kycStatus: state.kyc.status,
      hasLegacyPlan: state.legacy.plan !== null,
      pendingChoices: pending(state.maturityChoices),
      pendingRequests:
        pending(state.manualDeposits) +
        pending(state.cashWithdrawals) +
        pending(state.positionWithdrawals),
      positionCount: aggregates.positionCount,
    }),
    alerts: { unreadCount: unreadCount(state), latest: newestAlerts(state, 5).map(alertView) },
  };
}

export function investments(ctx: SampleContext): Investments {
  const { state } = ctx;
  const now = ctx.now();
  const positions = [...state.positions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, POSITIONS_LISTED)
    .map((p) => positionDto(state, p, now));
  const maturityChoices = state.maturityChoices
    .filter((c) => c.status === 'PENDING')
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
    .flatMap((c) => {
      const position = state.positions.find((p) => p.id === c.investmentId);
      if (!position) return [];
      return [
        {
          id: c.id,
          investmentId: c.investmentId,
          planName: planOf(state, position).name,
          amountCents: position.amountCents,
          currency: position.currency,
          expiresAt: iso(c.expiresAt),
        },
      ];
    });
  return { asOf: iso(now), positions, maturityChoices };
}

export function investment(ctx: SampleContext, rawId: string): InvestmentDetail {
  const id = requireQuery('id', rawId);
  const { state } = ctx;
  const position = state.positions.find((p) => p.id === id);
  if (!position) fail('not_found', 404, 'Position not found.');
  const withdrawals = state.positionWithdrawals
    .filter((w) => w.investmentId === id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((w) => ({
      id: w.id,
      status: w.status,
      amountCents: w.amountCents,
      notes: w.notes,
      createdAt: iso(w.createdAt),
      reviewedAt: isoOrNull(w.reviewedAt),
    }));
  return {
    asOf: iso(ctx.now()),
    position: positionDto(state, position, ctx.now()),
    withdrawals,
    canRequestWithdrawal:
      position.status === 'MATURED' && !withdrawals.some((w) => IN_FLIGHT.has(w.status)),
  };
}

export function strategies(ctx: SampleContext): Strategies {
  const { state } = ctx;
  const kycRequired = state.brand.features.kyc;
  // Flagship first, then by rising risk; the sort is stable, so equal plans keep their order.
  const plans = state.plans
    .filter((p) => p.active)
    .sort((a, b) => Number(b.flagship) - Number(a.flagship) || a.riskRating - b.riskRating);
  return {
    capacity: capacityFor(state),
    kyc: {
      required: kycRequired,
      approved: kycRequired ? state.kyc.status === 'APPROVED' : true,
    },
    strategies: plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      symbol: p.symbol,
      assetClass: p.assetClass,
      category: p.category,
      sector: p.sector,
      projectedReturnPct: p.projectedReturnPct,
      termMonths: p.termMonths,
      riskRating: p.riskRating,
      flagship: p.flagship,
      minimumCents: minimumOf(state, p),
      requiredTier: p.requiredTier ? tierView(p.requiredTier) : null,
      unlocked: p.requiredTier === null || meetsTier(state.user.tier, p.requiredTier),
    })),
  };
}

export function history(ctx: SampleContext): History {
  return sampleStatements.history(ctx.state);
}

export function statements(ctx: SampleContext, kind: StatementKind): StatementPeriods {
  const k: StatementKind = kind === 'quarterly' ? 'quarterly' : 'monthly';
  const first = sampleStatements.firstActivity(ctx.state);
  return {
    kind: k,
    periods: sampleStatements.listPeriods(first, ctx.now(), k).map((p) => ({
      key: p.key,
      label: p.label,
      start: iso(p.start),
      end: iso(p.end),
    })),
  };
}

function periodParam(raw: string): StatementPeriodRange {
  const period = sampleStatements.parsePeriodKey(requireQuery('period', raw, 16));
  if (!period) {
    fail('invalid_input', 400, 'Unknown statement period.', {
      fields: { period: 'Use a period like 2026-06 or 2026-Q2' },
    });
  }
  return period;
}

export function statement(ctx: SampleContext, rawPeriod: string): StatementDetail {
  return sampleStatements.buildStatement(ctx.state, periodParam(rawPeriod), ctx.now());
}

export function statementCsv(ctx: SampleContext, rawPeriod: string): string {
  return sampleStatements.toCsv(statement(ctx, rawPeriod), ctx.state.brand.name);
}
