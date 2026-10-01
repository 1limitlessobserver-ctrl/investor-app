import { describe, it, expect } from 'vitest';
import { sampleData } from './sampleData';
import { sampleStatements } from './sampleStatements';

const now = new Date('2026-10-01T12:00:00.000Z');
const period = (key: string) => {
  const p = sampleStatements.parsePeriodKey(key);
  if (!p) throw new Error(`not a period: ${key}`);
  return p;
};

describe('sampleStatements periods', () => {
  const state = sampleData.createState({ now });

  it('lists the investor’s months and quarters, newest first, from the first activity', () => {
    const first = sampleStatements.firstActivity(state);
    expect(first?.toISOString()).toBe('2024-08-27T08:00:00.000Z'); // the initial funding
    const months = sampleStatements.listPeriods(first, now, 'monthly');
    expect(months).toHaveLength(27);
    expect(months[0]).toEqual({
      key: '2026-10',
      kind: 'monthly',
      label: 'October 2026',
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(months.at(-1)?.key).toBe('2024-08');
    const quarters = sampleStatements.listPeriods(first, now, 'quarterly');
    expect(quarters.map((q) => q.key)).toEqual([
      '2026-Q4',
      '2026-Q3',
      '2026-Q2',
      '2026-Q1',
      '2025-Q4',
      '2025-Q3',
      '2025-Q2',
      '2025-Q1',
      '2024-Q4',
      '2024-Q3',
    ]);
    expect(quarters[1]).toEqual({
      key: '2026-Q3',
      kind: 'quarterly',
      label: 'Q3 2026',
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(sampleStatements.listPeriods(null, now, 'monthly').map((p) => p.key)).toEqual([
      '2026-10',
    ]);
  });

  it('reads a period key by its syntax alone, as the platform does', () => {
    expect(period('2026-09')).toMatchObject({ kind: 'monthly', label: 'September 2026' });
    expect(period('2031-Q2')).toEqual({
      key: '2031-Q2',
      kind: 'quarterly',
      label: 'Q2 2031',
      start: new Date('2031-04-01T00:00:00.000Z'),
      end: new Date('2031-07-01T00:00:00.000Z'),
    });
    for (const bad of [
      '2026-13',
      '2026-00',
      '2026-Q5',
      '2026-Q0',
      '2026-9',
      'Q3-2026',
      '',
      ' 2026-09',
    ]) {
      expect(sampleStatements.parsePeriodKey(bad), bad).toBeNull();
    }
  });
});

describe('sampleStatements detail', () => {
  const state = sampleData.createState({ now });

  it('builds a quarter from the cash ledger and the maturities in it', () => {
    const s = sampleStatements.buildStatement(state, period('2026-Q3'), now);
    expect(s.period).toEqual({
      key: '2026-Q3',
      kind: 'quarterly',
      label: 'Q3 2026',
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-10-01T00:00:00.000Z',
    });
    expect(s.asOf).toBe('2026-10-01T00:00:00.000Z');
    expect(s.holder).toEqual({ fullName: 'Alex Morgan', email: 'alex.morgan@example.com' });
    expect([s.currency, s.bases]).toEqual(['USD', { cash: 'records', positions: 'projection' }]);
    expect([s.openingBalanceCents, s.closingBalanceCents]).toEqual([0, 1_250_000]);
    expect(s.lines.map((l) => [l.id, l.kind, l.direction, l.amountCents, l.date])).toEqual([
      ['maturity_pos_evergreen', 'maturity', 'Info', 10_750_000, '2026-09-25T08:00:00.000Z'],
      ['led_payout', 'withdrawal', 'Out', -500_000, '2026-09-09T07:00:00.000Z'],
      ['led_wire', 'deposit', 'In', 1_750_000, '2026-07-30T10:00:00.000Z'],
    ]);
    expect(s.totals).toEqual({
      depositsCents: 1_750_000,
      withdrawalsCents: 500_000,
      referralCents: 0,
      manualCreditsCents: 0,
      manualDebitsCents: 0,
      maturitiesCents: 10_750_000,
      realizedYieldCents: 750_000,
    });
    expect(s.positions.map((p) => [p.investmentId, p.status, p.principalCents])).toEqual([
      ['pos_helios', 'ACTIVE', 42_000_000],
      ['pos_orbital', 'ACTIVE', 30_000_000],
      ['pos_meridian', 'ACTIVE', 18_000_000],
      ['pos_evergreen', 'MATURED', 10_000_000],
    ]);
    expect(s.positions[3]).toMatchObject({
      planName: 'Evergreen Green Bond',
      accruedCents: 750_000,
      realizedCents: 750_000,
      withdrawableCents: 10_750_000,
    });
    expect(s.positions[0]).toMatchObject({ realizedCents: 0, withdrawableCents: 0 });
    const earnings = s.positions.reduce((sum, p) => sum + p.accruedCents, 0);
    expect(s.positionSummary).toEqual({
      deployedCents: 100_000_000,
      earningsCents: earnings,
      portfolioValueCents: 100_000_000 + earnings,
      positionCount: 4,
    });
  });

  it('shows a position as it stood at the end of the period', () => {
    const june = sampleStatements.buildStatement(state, period('2026-06'), now);
    expect(june.positions.find((p) => p.investmentId === 'pos_evergreen')).toMatchObject({
      status: 'ACTIVE',
      realizedCents: 0,
      withdrawableCents: 0,
    });
    const before = sampleStatements.buildStatement(state, period('2020-01'), now);
    expect([before.lines, before.positions, before.closingBalanceCents]).toEqual([[], [], 0]);
  });

  it('counts an entry on a period’s first instant in that period, never the one before', () => {
    const edges = sampleData.createState({ now });
    edges.ledger.push(
      {
        id: 'led_start',
        date: new Date('2026-07-01T00:00:00.000Z'),
        kind: 'manual_credit',
        description: 'On the first instant of Q3',
        amountCents: 100,
      },
      {
        id: 'led_end',
        date: new Date('2026-10-01T00:00:00.000Z'),
        kind: 'manual_credit',
        description: 'On the first instant of Q4',
        amountCents: 200,
      },
    );
    const q3 = sampleStatements.buildStatement(edges, period('2026-Q3'), now);
    expect(q3.lines.map((l) => l.id)).toContain('led_start');
    expect(q3.lines.map((l) => l.id)).not.toContain('led_end');
    expect([q3.openingBalanceCents, q3.totals.manualCreditsCents]).toEqual([0, 100]);
    const q2 = sampleStatements.buildStatement(edges, period('2026-Q2'), now);
    expect(q2.lines.map((l) => l.id)).not.toContain('led_start');
    const q4 = sampleStatements.buildStatement(edges, period('2026-Q4'), now);
    expect(q4.openingBalanceCents).toBe(1_250_000 + 100);
    expect(q4.lines.map((l) => l.id)).toEqual(['led_end']);
  });

  it('keeps the running period open until now', () => {
    const s = sampleStatements.buildStatement(state, period('2026-10'), now);
    expect(s.asOf).toBe(now.toISOString());
    expect(s.lines).toEqual([]);
    expect([s.openingBalanceCents, s.closingBalanceCents]).toEqual([1_250_000, 1_250_000]);
  });

  it('carries the latest complete quarter as the sample world’s statement', () => {
    expect(state.statement).toEqual(sampleStatements.buildStatement(state, period('2026-Q3'), now));
  });
});

describe('sampleStatements CSV', () => {
  const state = sampleData.createState({ now });

  it('exports the statement with its header, lines and positions', () => {
    const csv = sampleStatements.toCsv(state.statement, 'Everest Reserve');
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('Everest Reserve — Account Statement');
    expect(csv).toContain('Period,Q3 2026,2026-Q3');
    expect(csv).toContain('Date,Type,Description,Direction,Amount (USD)');
    expect(csv).toContain('2026-09-09,withdrawal,Cash payout · bank wire ending 4410,Out,-5000.00');
    expect(csv).toContain('Closing balance,12500.00');
    for (const line of state.statement.lines) expect(csv).toContain(line.description);
    for (const p of state.statement.positions) expect(csv).toContain(p.planName);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes text that carries a comma, a quote or a leading formula sign', () => {
    const s = structuredClone(state.statement);
    s.lines = [
      { ...s.lines[0]!, description: 'Wire, "urgent"' },
      { ...s.lines[0]!, id: 'x', description: '=HYPERLINK("x")' },
      { ...s.lines[0]!, id: 'y', description: '+1 bonus' },
      { ...s.lines[0]!, id: 'z', description: '-fee' },
      { ...s.lines[0]!, id: 'w', description: '@SUM(A1)' },
    ];
    const csv = sampleStatements.toCsv(s, 'A, B & Co');
    expect(csv.split('\r\n')[0]).toBe('"A, B & Co — Account Statement"');
    expect(csv).toContain(',"Wire, ""urgent""",');
    expect(csv).toContain(`,"'=HYPERLINK(""x"")",`);
    for (const text of ['+1 bonus', '-fee', '@SUM(A1)']) expect(csv).toContain(`,'${text},`);
    expect(csv).toContain(',Info,107500.00'); // amounts are numbers, never guarded
  });
});

describe('sampleStatements history', () => {
  const state = sampleData.createState({ now });

  it('lists deposits, maturities and paid withdrawals newest first, with their totals', () => {
    const h = sampleStatements.history(state);
    expect(h.entries.map((e) => [e.id, e.kind, e.status, e.amountCents, e.date])).toEqual([
      ['top_card', 'deposit', 'PAID', 1_000_000, '2026-09-26T06:00:00.000Z'],
      ['maturity_pos_evergreen', 'maturity', 'MATURED', 10_750_000, '2026-09-25T09:00:00.000Z'],
      ['cw_payout', 'withdrawal_paid', 'PAID', 500_000, '2026-09-09T07:00:00.000Z'],
      ['dep_wire', 'deposit', 'PAID', 1_750_000, '2026-07-30T10:00:00.000Z'],
      ['pw_treasury', 'withdrawal_paid', 'PAID', 26_300_000, '2025-09-05T06:00:00.000Z'],
      ['maturity_pos_treasury', 'maturity', 'WITHDRAWN', 26_300_000, '2025-09-05T06:00:00.000Z'],
      ['top_initial', 'deposit', 'PAID', 115_000_000, '2024-08-27T08:00:00.000Z'],
    ]);
    expect(h.entries.every((e) => e.title.length > 0 && e.detail.length > 0)).toBe(true);
    expect(h.summary).toEqual({
      totalDepositedCents: 117_750_000,
      totalWithdrawnCents: 26_800_000,
      portfolioValueCents: 0,
      netCents: 90_950_000,
    });
    expect(h.truncated).toBe(false);
  });

  it('returns the newest 200 and says when there are more', () => {
    const busy = sampleData.createState({ now });
    for (let i = 0; i < 250; i++) {
      busy.topUps.push({
        id: `t${i}`,
        amountCents: 1_000,
        date: new Date(Date.UTC(2023, 0, 1) + i * 86_400_000),
        label: 'Top-up',
      });
    }
    const h = sampleStatements.history(busy);
    expect(h.entries).toHaveLength(200);
    expect(h.truncated).toBe(true);
    expect(h.summary.totalDepositedCents).toBe(117_750_000 + 250_000);
  });
});
