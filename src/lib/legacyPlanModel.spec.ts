import { describe, it, expect } from 'vitest';
import { legacyPlanModel } from './legacyPlanModel';

describe('legacyPlanModel', () => {
  it('projects the default plan exactly as the platform does', () => {
    const p = legacyPlanModel.project(legacyPlanModel.defaultPlan);
    expect([p.endingCapitalCents, p.realCapitalCents, p.plannedContributionsCents]).toEqual([
      26500000, 16081424, 26500000,
    ]);
    expect([
      p.futureMonthlyIncomeGoalCents,
      p.targetCapitalCents,
      p.modelledMonthlyDrawCents,
      p.realMonthlyDrawCents,
    ]).toEqual([329573, 98871900, 88333, 53605]);
    expect(p.coveragePercent).toBe(26.8);
    expect(p.points.length).toBe(21);
    expect(p.points[1]).toEqual({
      year: 1,
      nominalCents: 3700000,
      realCents: 3608741,
      contributionCents: 3700000,
    });
  });
  it('projects returns and fees exactly as the platform does', () => {
    const p = legacyPlanModel.project({
      ...legacyPlanModel.defaultPlan,
      annualReturnBps: 600,
      annualFeeBps: 75,
      monthlyContributionCents: 150000,
      horizonYears: 25,
    });
    expect([
      p.endingCapitalCents,
      p.realCapitalCents,
      p.modelledGainsCents,
      p.modelledFeesCents,
    ]).toEqual([101999065, 54631672, 62284651, 7785586]);
    expect([p.targetCapitalCents, p.modelledMonthlyDrawCents, p.coveragePercent]).toEqual([
      112021800, 339997, 91,
    ]);
  });
  it('refuses a scenario outside the supported range', () => {
    expect(() =>
      legacyPlanModel.project({
        ...legacyPlanModel.defaultPlan,
        horizonYears: 50,
        startingCapitalCents: 100000000000,
        annualReturnBps: 3000,
      }),
    ).toThrow('This scenario exceeds the supported range. Reduce the amount, rate or horizon.');
  });
  it('caps the coverage at 999% and has no target without a draw rate', () => {
    const rich = legacyPlanModel.project({
      ...legacyPlanModel.defaultPlan,
      startingCapitalCents: 10_000_000_000,
      monthlyIncomeGoalCents: 100,
    });
    expect(rich.coveragePercent).toBe(999);
    const noDraw = legacyPlanModel.project({ ...legacyPlanModel.defaultPlan, annualDrawBps: 0 });
    expect([
      noDraw.targetCapitalCents,
      noDraw.coveragePercent,
      noDraw.modelledMonthlyDrawCents,
    ]).toEqual([null, null, 0]);
  });
  it('offers the platform’s four focuses, in its order, with their glyphs', () => {
    expect(legacyPlanModel.focuses.map((f) => [f.id, f.label, f.glyph])).toEqual([
      ['freedom', 'More freedom', '↗'],
      ['family', 'Family continuity', '◇'],
      ['resilience', 'Greater resilience', '◎'],
      ['impact', 'Lasting impact', '✦'],
    ]);
  });
});
