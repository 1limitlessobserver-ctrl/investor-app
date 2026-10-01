import { describe, it, expect } from 'vitest';
import expected from './__fixtures__/expected.json';
import { sampleData } from './sampleData';
import { portfolioMath, type PositionInput } from './portfolioMath';

// The platform's own cases (src/lib/mobile/portfolio.test.ts), unchanged but for the import.
const energy: PositionInput = {
  id: 'inv-1',
  planName: 'Solar Income',
  sector: 'Energy',
  amountCents: 100_000,
  projectedReturnPct: 12,
  termMonths: 12,
  status: 'ACTIVE',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  maturesAt: new Date('2027-01-01T00:00:00.000Z'),
};
const half = new Date('2026-07-02T12:00:00.000Z'); // exactly half of the 365-day term

describe('portfolioMath (the platform’s own cases)', () => {
  it('values a position at principal plus time-weighted accrual', () => {
    expect(portfolioMath.positionView(energy, half)).toEqual({
      principalCents: 100_000,
      accruedCents: 6_000,
      termReturnCents: 12_000,
      valueCents: 106_000,
      progressPct: 50,
    });
    expect(portfolioMath.positionView({ ...energy, status: 'MATURED' }, half)).toMatchObject({
      accruedCents: 12_000,
      progressPct: 100,
    });
    expect(
      portfolioMath.positionView(
        { ...energy, status: 'PENDING', startedAt: null, maturesAt: null },
        half,
      ),
    ).toEqual({
      principalCents: 100_000,
      accruedCents: 0,
      termReturnCents: 0,
      valueCents: 100_000,
      progressPct: 0,
    });
  });

  it('weights allocation by principal per sector, falling back to the plan name', () => {
    const tech: PositionInput = {
      ...energy,
      id: 'inv-2',
      sector: 'Technology',
      amountCents: 300_000,
    };
    expect(portfolioMath.allocationBySector([energy, tech])).toEqual([
      { label: 'Technology', valueCents: 300_000, weightPct: 75 },
      { label: 'Energy', valueCents: 100_000, weightPct: 25 },
    ]);
    expect(portfolioMath.allocationBySector([{ ...energy, sector: null }])).toEqual([
      { label: 'Solar Income', valueCents: 100_000, weightPct: 100 },
    ]);
    expect(portfolioMath.allocationBySector([])).toEqual([]);
  });

  it('draws a projection from the first start to the last maturity', () => {
    const points = portfolioMath.projectionSeries([energy], half);
    expect(points).toHaveLength(24);
    expect(points[0]).toEqual({ date: '2026-01-01T00:00:00.000Z', valueCents: 100_000 });
    expect(points[23]).toEqual({ date: '2027-01-01T00:00:00.000Z', valueCents: 112_000 });
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.valueCents).toBeGreaterThanOrEqual(points[i - 1]!.valueCents);
    }
    const later: PositionInput = {
      ...energy,
      id: 'inv-3',
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
      maturesAt: new Date('2027-07-01T00:00:00.000Z'),
    };
    expect(portfolioMath.projectionSeries([energy, later], half)[0]?.valueCents).toBe(100_000);
    expect(portfolioMath.projectionSeries([], half)).toEqual([]);
  });

  it('suggests the next steps in priority order', () => {
    const base = {
      kycRequired: true,
      kycStatus: 'NONE',
      hasLegacyPlan: false,
      pendingChoices: 0,
      pendingRequests: 0,
      positionCount: 0,
    };
    expect(portfolioMath.nextSteps(base).map((s) => s.id)).toEqual([
      'verify_identity',
      'legacy_plan',
      'first_investment',
    ]);
    expect(
      portfolioMath
        .nextSteps({
          ...base,
          kycStatus: 'PENDING',
          pendingChoices: 1,
          pendingRequests: 2,
          hasLegacyPlan: true,
          positionCount: 3,
        })
        .map((s) => s.id),
    ).toEqual(['kyc_pending', 'maturity_choice', 'pending_requests']);
    expect(
      portfolioMath.nextSteps({
        ...base,
        kycRequired: false,
        hasLegacyPlan: true,
        positionCount: 1,
      }),
    ).toEqual([]);
  });
});

// src/lib/investments/lifecycle.ts has no staged spec, and the cases above leave a few branches
// open; these pin the documented behaviour.
describe('portfolioMath (what the platform’s staged cases leave open)', () => {
  it('ends the projection at now once every position has matured', () => {
    const later = new Date('2028-01-01T00:00:00.000Z');
    const points = portfolioMath.projectionSeries([energy], later);
    expect(points.at(-1)).toEqual({ date: later.toISOString(), valueCents: 112_000 });
  });

  const earnings = (status: string, now: Date, maturesAt = energy.maturesAt!) =>
    portfolioMath.computeEarnings({
      amountCents: 100_000,
      projectedReturnPct: 12,
      termMonths: 12,
      startedAt: energy.startedAt!,
      maturesAt,
      status,
      now,
    });

  it('accrues an active position by elapsed term and realises a matured one in full', () => {
    expect(earnings('ACTIVE', half)).toEqual({
      principalCents: 100_000,
      termReturnCents: 12_000,
      accruedCents: 6_000,
      realizedCents: 0,
      isRealized: false,
    });
    expect(earnings('MATURED', half)).toEqual({
      principalCents: 100_000,
      termReturnCents: 12_000,
      accruedCents: 12_000,
      realizedCents: 12_000,
      isRealized: true,
    });
    expect(earnings('ACTIVE', new Date('2025-01-01T00:00:00.000Z')).accruedCents).toBe(0);
    expect(earnings('ACTIVE', new Date('2030-01-01T00:00:00.000Z')).accruedCents).toBe(12_000);
    expect(earnings('ACTIVE', half, energy.startedAt!).accruedCents).toBe(0); // a zero-length term
  });

  it('aggregates the open, dated positions only', () => {
    expect(portfolioMath.getUserAggregates([], half)).toEqual({
      deployedCents: 0,
      portfolioValueCents: 0,
      earningsCents: 0,
      projectedYieldPct: 0,
      positionCount: 0,
      activeCount: 0,
      maturedCount: 0,
    });
    const rows: PositionInput[] = [
      energy,
      { ...energy, id: 'inv-2', status: 'MATURED', amountCents: 300_000, projectedReturnPct: 8 },
      { ...energy, id: 'inv-3', status: 'PENDING', startedAt: null, maturesAt: null },
      { ...energy, id: 'inv-4', status: 'WITHDRAWN' },
      { ...energy, id: 'inv-5', startedAt: null },
    ];
    expect(portfolioMath.getUserAggregates(rows, half)).toEqual({
      deployedCents: 400_000,
      portfolioValueCents: 400_000 + 6_000 + 24_000,
      earningsCents: 30_000,
      projectedYieldPct: 9,
      positionCount: 2,
      activeCount: 1,
      maturedCount: 1,
    });
  });

  it('labels the four figures as projections in whole dollars', () => {
    const a = portfolioMath.getUserAggregates([energy], half);
    expect(portfolioMath.buildLiveKpis(a, null)).toEqual([
      {
        label: 'Projected Portfolio',
        value: '$1,060',
        deltaPct: 0,
        spark: [],
        basis: 'projection',
        hint: '1 recorded position · principal + estimate',
      },
      {
        label: 'Estimated Earnings',
        value: '$60',
        deltaPct: 0,
        spark: [],
        basis: 'projection',
        hint: 'Plan-rate estimate · not realized profit',
      },
      {
        label: 'Projected Yield',
        value: '12%',
        deltaPct: 0,
        spark: [],
        basis: 'projection',
        hint: 'Configured plan rates · annualized',
      },
      {
        label: 'Projection-based Rank',
        value: '—',
        deltaPct: 0,
        spark: [],
        basis: 'projection',
        hint: 'Estimate-based ranking · not measured performance',
      },
    ]);
    expect(portfolioMath.buildLiveKpis(a, 1234)[3]?.value).toBe('#1,234');
  });
});

// The brief's parity spec, adjusted to the fixture (ruling 5) and to the platform's arguments as
// gen/generate.ts called the functions:
//   - expected.json carries `now`, not `generatedAt`; `positions` is keyed by id; the projection is
//     summarised as { length, first, middle: series[11], last }; `nextSteps` lists the ids only;
//     `kpis` are mapped as the dashboard route maps them ({ label, value, hint, basis }).
//   - positionView, allocationBySector and projectionSeries take PositionInput rows (generate.ts
//     joins each position with its plan, as the platform's toPositionInput does); allocation and
//     projection get the ACTIVE and MATURED ones, as GET /dashboard passes them.
//   - getUserAggregates(rows, now) is the platform's function minus its database read (which
//     selected the ACTIVE and MATURED positions); buildLiveKpis(aggregates, rank) and
//     nextSteps(NextStepsInput) keep the platform's signatures. The next-steps input is read from
//     the sample world the way GET /dashboard reads it from the database.
describe('portfolioMath parity with the platform', () => {
  const now = new Date(expected.now);
  const state = sampleData.createState({ now });
  const planById = new Map(state.plans.map((p) => [p.id, p]));
  const inputs: PositionInput[] = state.positions.map((p) => {
    const plan = planById.get(p.planId)!;
    return {
      id: p.id,
      planName: plan.name,
      sector: plan.sector,
      amountCents: p.amountCents,
      projectedReturnPct: plan.projectedReturnPct,
      termMonths: plan.termMonths,
      status: p.status,
      startedAt: p.startedAt,
      maturesAt: p.maturesAt,
    };
  });
  const open = inputs.filter((p) => p.status === 'ACTIVE' || p.status === 'MATURED');

  it('values every position as the platform does', () => {
    expect(inputs.map((p) => p.id)).toEqual(Object.keys(expected.positions));
    const want = expected.positions as Record<string, unknown>;
    for (const p of inputs) expect(portfolioMath.positionView(p, now), p.id).toEqual(want[p.id]);
  });

  it('aggregates, allocates, projects and advises as the platform does', () => {
    const aggregates = portfolioMath.getUserAggregates(inputs, now);
    expect(aggregates).toEqual(expected.aggregates);
    expect(portfolioMath.allocationBySector(open)).toEqual(expected.allocation);
    const series = portfolioMath.projectionSeries(open, now);
    expect({
      length: series.length,
      first: series[0],
      middle: series[11],
      last: series[series.length - 1],
    }).toEqual(expected.series);
    expect(
      portfolioMath.buildLiveKpis(aggregates, state.rank).map((k) => ({
        label: k.label,
        value: k.value,
        hint: k.hint,
        basis: k.basis ?? 'projection',
      })),
    ).toEqual(expected.kpis);
    const steps = portfolioMath.nextSteps({
      kycRequired: state.brand.features.kyc,
      kycStatus: state.kyc.status,
      hasLegacyPlan: state.legacy.plan !== null,
      pendingChoices: state.maturityChoices.filter((c) => c.status === 'PENDING').length,
      pendingRequests:
        state.manualDeposits.filter((d) => d.status === 'PENDING').length +
        state.cashWithdrawals.filter((w) => w.status === 'PENDING').length +
        state.positionWithdrawals.filter((w) => w.status === 'PENDING').length,
      positionCount: aggregates.positionCount,
    });
    expect(steps.map((s) => s.id)).toEqual(expected.nextSteps);
  });
});
