import { describe, it, expect } from 'vitest';
import type { Dashboard, Investments, PositionView } from '../api/types';
import {
  ORACLE_DISCLAIMER,
  ORACLE_SUGGESTIONS,
  sampleOracleAnswer,
  sampleOracleText,
  type SampleOracleContext,
} from './sampleOracle';

// Ported from Plan B's helpers/sampleOracle.spec.tsx: the same cases and assertions.
const now = new Date('2026-10-01T12:00:00.000Z');

function position(over: Partial<PositionView> & { name: string }): PositionView {
  const { name, ...rest } = over;
  return {
    id: name,
    status: 'ACTIVE',
    currency: 'USD',
    basis: 'projection',
    plan: {
      id: name,
      name,
      slug: name,
      symbol: null,
      sector: null,
      assetClass: 'PRE_IPO',
      projectedReturnPct: 12,
      termMonths: 12,
    },
    principalCents: 1_000_000,
    accruedCents: 0,
    termReturnCents: 120_000,
    valueCents: 1_000_000,
    progressPct: 50,
    startedAt: '2026-04-01T12:00:00.000Z',
    maturesAt: '2027-04-01T12:00:00.000Z',
    closedAt: null,
    createdAt: '2026-04-01T12:00:00.000Z',
    basketRef: null,
    ...rest,
  };
}

function context(): SampleOracleContext {
  const dashboard = {
    totals: {
      basis: 'projection',
      deployedCents: 3_000_000,
      portfolioValueCents: 3_141_500,
      earningsCents: 141_500,
      projectedYieldPct: 11.5,
      positionCount: 3,
      activeCount: 2,
      maturedCount: 1,
    },
    cash: { balanceCents: 250_000, wallets: [] },
    allocation: [
      { label: 'Space', valueCents: 2_000_000, weightPct: 63.7 },
      { label: 'Energy', valueCents: 1_141_500, weightPct: 36.3 },
    ],
  } as unknown as Dashboard;
  const investments: Investments = {
    asOf: now.toISOString(),
    positions: [
      position({ name: 'Orbital Logistics', maturesAt: '2027-01-01T12:00:00.000Z' }),
      position({
        name: 'Fusion Grid',
        maturesAt: '2026-10-11T12:00:00.000Z',
        principalCents: 500_000,
        termReturnCents: 40_000,
      }),
      position({ name: 'Green Bond', status: 'MATURED', maturesAt: '2026-09-28T12:00:00.000Z' }),
    ],
    maturityChoices: [
      {
        id: 'c1',
        investmentId: 'Green Bond',
        planName: 'Green Bond',
        amountCents: 1_120_000,
        currency: 'USD',
        expiresAt: '2026-10-05T12:00:00.000Z',
      },
    ],
  };
  return { brandName: 'Northwind Wealth', dashboard, investments, now };
}

describe('sampleOracle', () => {
  it('answers the allocation question from the sample portfolio', () => {
    const text = sampleOracleText(ORACLE_SUGGESTIONS[0], context());
    expect(text).toContain('Space 63.7% ($20,000)');
    expect(text).toContain('Energy 36.3% ($11,415)');
    expect(text).toContain('$31,415');
  });

  it('names the nearest maturity and the choice that is waiting', () => {
    const text = sampleOracleText(ORACLE_SUGGESTIONS[1], context());
    expect(text).toContain('Fusion Grid');
    expect(text).toContain('10 days from now');
    expect(text).toContain('$5,400');
    expect(text).toContain('Green Bond has already matured');
    expect(text).not.toContain('Orbital Logistics');
  });

  it('matches a suggestion however it is typed', () => {
    expect(sampleOracleText('  how do WITHDRAWALS work ', context())).toContain('$2,500');
    expect(sampleOracleText('What does "projection" mean here', context())).toContain('$1,415');
  });

  it('says what the sample cannot answer, and always ends with the disclaimer', () => {
    const other = sampleOracleText('Should I buy more?', context());
    expect(other).toContain('only answers the suggested questions');
    expect(other).toContain('Northwind Wealth');
    for (const question of [...ORACLE_SUGGESTIONS, 'Should I buy more?']) {
      expect(sampleOracleText(question, context()).endsWith(ORACLE_DISCLAIMER)).toBe(true);
    }
  });

  it('returns the live answer shape', () => {
    const answer = sampleOracleAnswer(ORACLE_SUGGESTIONS[5], context(), 'conv-1', 640);
    expect([answer.conversationId, answer.model, answer.latencyMs]).toEqual([
      'conv-1',
      'sample',
      640,
    ]);
    expect(answer.retrieved).toEqual({ knowledge: [], conversations: [] });
    expect(answer.answer).toContain('Northwind Wealth never asks');
  });
});
