// Statement periods, statements, their CSV and the transaction history of the sample world, built
// from its rows. The platform's own builders (src/lib/reporting/{periods,statements}.ts and
// src/lib/account/history.ts) are not staged, so this follows what is: the shapes are the route
// handlers', and the rules are the ones the route tests, Plan B's types (gen/mobileTypes.final.tsx)
// and MOBILE_API.md record. Where they say nothing, the choice is noted beside the code.
//
//   - Periods are UTC months ("2026-09", "September 2026") and quarters ("2026-Q3", "Q3 2026"),
//     newest first, from the one holding the first activity to the one holding now.
//   - A statement runs to `asOf`, the period's end or now while it is running. Its cash lines are
//     the cash ledger's entries in the period (money in positive, out negative); each maturity in
//     the period adds an 'Info' line holding the modelled amount (principal plus the term's
//     projected return), since no cash moves. Its positions are the ACTIVE and MATURED ones, as
//     they stood at `asOf`, valued with the platform's portfolio maths.
//   - History lists card top-ups and approved deposit requests (deposit, PAID), maturities
//     (MATURED or WITHDRAWN) and reviewed withdrawals (PAID or REJECTED), newest first.
import type {
  History,
  HistoryEntry,
  StatementDetail,
  StatementKind,
  StatementLine,
  StatementPosition,
} from '../api/types';
import { computeEarnings, positionView } from './portfolioMath';
import { planOf, toPositionInput } from './rows';
import type { SampleState } from './sampleData';

/** A statement period with its instants as dates. */
export interface StatementPeriodRange {
  key: string;
  kind: StatementKind;
  label: string;
  /** The first instant of the period, UTC. */
  start: Date;
  /** The first instant of the next period, UTC. */
  end: Date;
}

/** The newest 200 history entries are listed; the summary covers them all. */
const HISTORY_LIMIT = 200;

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

function monthPeriod(year: number, month: number): StatementPeriodRange {
  const start = new Date(Date.UTC(year, month - 1, 1));
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    kind: 'monthly',
    label: `${monthName.format(start)} ${year}`,
    start,
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function quarterPeriod(year: number, quarter: number): StatementPeriodRange {
  return {
    key: `${year}-Q${quarter}`,
    kind: 'quarterly',
    label: `Q${quarter} ${year}`,
    start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
    end: new Date(Date.UTC(year, quarter * 3, 1)),
  };
}

/**
 * "2026-09" (month 01 to 12) or "2026-Q3" (Q1 to Q4), any year; null otherwise. The syntax alone
 * decides, as on the platform: a period before the first activity or in the future is a period.
 */
function parsePeriodKey(key: string): StatementPeriodRange | null {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (month) return monthPeriod(Number(month[1]), Number(month[2]));
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) return quarterPeriod(Number(quarter[1]), Number(quarter[2]));
  return null;
}

/** The period of `kind` that holds `date`. */
function periodOf(date: Date, kind: StatementKind): StatementPeriodRange {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return kind === 'monthly'
    ? monthPeriod(year, month + 1)
    : quarterPeriod(year, Math.floor(month / 3) + 1);
}

/**
 * The investor's periods, newest first: from the one holding `first` (the first activity) to the
 * one holding `now`, or that one alone when there is no activity yet.
 */
function listPeriods(first: Date | null, now: Date, kind: StatementKind): StatementPeriodRange[] {
  const oldest = periodOf(first && first.getTime() < now.getTime() ? first : now, kind);
  const periods: StatementPeriodRange[] = [];
  let period = periodOf(now, kind);
  while (period.start.getTime() >= oldest.start.getTime()) {
    periods.push(period);
    period = periodOf(new Date(period.start.getTime() - 1), kind);
  }
  return periods;
}

/**
 * The investor's first dated money record: a cash-ledger entry, a top-up, a deposit request or a
 * position. (The platform's getUserFirstActivity is not staged; its account's creation is not
 * counted here, since a statement before any money moved would be empty.)
 */
function firstActivity(
  state: Pick<SampleState, 'ledger' | 'topUps' | 'manualDeposits' | 'positions'>,
): Date | null {
  const times = [
    ...state.ledger.map((e) => e.date.getTime()),
    ...state.topUps.map((t) => t.date.getTime()),
    ...state.manualDeposits.map((d) => d.createdAt.getTime()),
    ...state.positions.map((p) => p.createdAt.getTime()),
  ];
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

function buildStatement(
  state: Pick<SampleState, 'user' | 'plans' | 'positions' | 'ledger'>,
  period: StatementPeriodRange,
  now: Date,
): StatementDetail {
  const asOf = Math.min(period.end.getTime(), now.getTime());
  const start = period.start.getTime();
  const inPeriod = (date: Date) => date.getTime() >= start && date.getTime() < asOf;

  const openingBalanceCents = sum(
    state.ledger.filter((e) => e.date.getTime() < start).map((e) => e.amountCents),
  );
  const cash = state.ledger.filter((e) => inPeriod(e.date));
  const closingBalanceCents = openingBalanceCents + sum(cash.map((e) => e.amountCents));
  const cashLines: StatementLine[] = cash.map((e) => ({
    id: e.id,
    kind: e.kind,
    date: e.date.toISOString(),
    description: e.description,
    amountCents: e.amountCents,
    direction: e.amountCents < 0 ? 'Out' : 'In',
  }));

  const maturities = state.positions.flatMap((p) => {
    if (p.status !== 'MATURED' && p.status !== 'WITHDRAWN') return [];
    if (!p.startedAt || !p.maturesAt || !inPeriod(p.maturesAt)) return [];
    const plan = planOf(state, p);
    const view = positionView(toPositionInput(p, plan), new Date(asOf));
    return [{ position: p, plan, view, maturesAt: p.maturesAt }];
  });
  const maturityLines: StatementLine[] = maturities.map(({ position, plan, view, maturesAt }) => ({
    id: `maturity_${position.id}`,
    kind: 'maturity',
    date: maturesAt.toISOString(),
    description: `${plan.name} matured`,
    amountCents: view.valueCents,
    direction: 'Info',
  }));
  // ISO-8601 instants sort as text; the sort is stable, so ties keep the ledger's order.
  const lines = [...cashLines, ...maturityLines].sort((a, b) => b.date.localeCompare(a.date));
  const totalOf = (kind: StatementLine['kind']) =>
    sum(cash.filter((e) => e.kind === kind).map((e) => e.amountCents));

  const positions: StatementPosition[] = state.positions
    .filter(
      (p) =>
        (p.status === 'ACTIVE' || p.status === 'MATURED') &&
        p.startedAt !== null &&
        p.startedAt.getTime() < asOf,
    )
    .map((p) => {
      // A position that matured after `asOf` was still running then.
      const matured =
        p.status === 'MATURED' && p.maturesAt !== null && p.maturesAt.getTime() <= asOf;
      const plan = planOf(state, p);
      const input = { ...toPositionInput(p, plan), status: matured ? 'MATURED' : 'ACTIVE' };
      const view = positionView(input, new Date(asOf));
      return {
        investmentId: p.id,
        planName: plan.name,
        principalCents: p.amountCents,
        status: matured ? 'MATURED' : 'ACTIVE',
        startedAt: p.startedAt?.toISOString() ?? null,
        maturesAt: p.maturesAt?.toISOString() ?? null,
        accruedCents: view.accruedCents,
        realizedCents: matured ? view.termReturnCents : 0,
        withdrawableCents: matured ? p.amountCents + view.termReturnCents : 0,
      } satisfies StatementPosition;
    })
    .sort((a, b) => b.principalCents - a.principalCents);
  const deployedCents = sum(positions.map((p) => p.principalCents));
  const earningsCents = sum(positions.map((p) => p.accruedCents));

  return {
    period: {
      key: period.key,
      kind: period.kind,
      label: period.label,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    asOf: new Date(asOf).toISOString(),
    holder: { fullName: state.user.fullName, email: state.user.email },
    currency: 'USD',
    bases: { cash: 'records', positions: 'projection' },
    openingBalanceCents,
    closingBalanceCents,
    totals: {
      depositsCents: totalOf('deposit'),
      // Totals of money out are absolute values, as the platform states for manual debits.
      withdrawalsCents: Math.abs(totalOf('withdrawal')),
      referralCents: totalOf('referral_commission'),
      manualCreditsCents: totalOf('manual_credit'),
      manualDebitsCents: Math.abs(totalOf('manual_debit')),
      maturitiesCents: sum(maturities.map((m) => m.view.valueCents)),
      realizedYieldCents: sum(maturities.map((m) => m.view.termReturnCents)),
    },
    lines,
    positions,
    positionSummary: {
      deployedCents,
      earningsCents,
      portfolioValueCents: deployedCents + earningsCents,
      positionCount: positions.length,
    },
  };
}

/** A CSV cell: text, or cents written as dollars with two decimals ("-5000.00"). */
type Cell = string | number;

function cell(value: Cell): string {
  if (typeof value === 'number') return (value / 100).toFixed(2);
  // A spreadsheet runs text that starts like a formula; a leading apostrophe keeps it text.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The statement as CSV (RFC 4180: CRLF line ends, quoted text where needed): a header naming the
 * company, the period, the holder and the cash balances, then the lines and the positions. The
 * platform's own file (account-statement-v2) is not staged; its first line is the same.
 */
function toCsv(s: StatementDetail, platformName: string): string {
  const rows: Cell[][] = [
    [`${platformName} — Account Statement`],
    ['Period', s.period.label, s.period.key],
    ['Holder', s.holder.fullName, s.holder.email],
    ['As of', s.asOf],
    ['Currency', s.currency],
    ['Opening balance', s.openingBalanceCents],
    ['Closing balance', s.closingBalanceCents],
    [],
    ['Date', 'Type', 'Description', 'Direction', 'Amount (USD)'],
    ...s.lines.map((l) => [
      l.date.slice(0, 10),
      l.kind,
      l.description,
      l.direction,
      l.amountCents ?? '',
    ]),
    [],
    ['Positions (projection: plan rates, not market prices)'],
    ['Plan', 'Status', 'Principal (USD)', 'Accrued (USD)', 'Started', 'Matures'],
    ...s.positions.map((p) => [
      p.planName,
      p.status,
      p.principalCents,
      p.accruedCents,
      p.startedAt?.slice(0, 10) ?? '',
      p.maturesAt?.slice(0, 10) ?? '',
    ]),
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function history(
  state: Pick<
    SampleState,
    'plans' | 'positions' | 'topUps' | 'manualDeposits' | 'cashWithdrawals' | 'positionWithdrawals'
  >,
): History {
  const entries: HistoryEntry[] = [];
  for (const t of state.topUps) {
    entries.push({
      id: t.id,
      kind: 'deposit',
      date: t.date.toISOString(),
      title: 'Deposit',
      detail: t.label,
      amountCents: t.amountCents,
      status: 'PAID',
    });
  }
  for (const d of state.manualDeposits) {
    if (d.status !== 'APPROVED') continue;
    entries.push({
      id: d.id,
      kind: 'deposit',
      date: (d.reviewedAt ?? d.createdAt).toISOString(),
      title: 'Deposit',
      detail: `${d.methodLabel ?? d.methodKind} · approved deposit`,
      amountCents: d.amountCents,
      status: 'PAID',
    });
  }
  const withdrawals = [
    ...state.cashWithdrawals.map((w) => ({ ...w, detail: w.destination ?? 'Cash payout' })),
    ...state.positionWithdrawals.map((w) => {
      const position = state.positions.find((p) => p.id === w.investmentId);
      return { ...w, detail: position ? planOf(state, position).name : 'Matured position' };
    }),
  ];
  for (const w of withdrawals) {
    if (w.status !== 'PAID' && w.status !== 'REJECTED') continue;
    entries.push({
      id: w.id,
      kind: w.status === 'PAID' ? 'withdrawal_paid' : 'withdrawal_rejected',
      date: (w.reviewedAt ?? w.createdAt).toISOString(),
      title: w.status === 'PAID' ? 'Withdrawal paid' : 'Withdrawal declined',
      detail: w.detail,
      amountCents: w.amountCents,
      status: w.status,
    });
  }
  for (const p of state.positions) {
    if (p.status !== 'MATURED' && p.status !== 'WITHDRAWN') continue;
    if (!p.startedAt || !p.maturesAt) continue;
    const plan = planOf(state, p);
    const { termReturnCents } = computeEarnings({
      amountCents: p.amountCents,
      projectedReturnPct: plan.projectedReturnPct,
      termMonths: plan.termMonths,
      startedAt: p.startedAt,
      maturesAt: p.maturesAt,
      status: 'MATURED',
      now: p.maturesAt,
    });
    entries.push({
      id: `maturity_${p.id}`,
      kind: 'maturity',
      date: (p.closedAt ?? p.maturesAt).toISOString(),
      title: 'Position matured',
      detail: plan.name,
      amountCents: p.amountCents + termReturnCents,
      status: p.status,
    });
  }
  // Newest first; the sort is stable, so entries of the same instant keep the order above.
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const totalDepositedCents = sum(
    entries.filter((e) => e.kind === 'deposit').map((e) => e.amountCents ?? 0),
  );
  const totalWithdrawnCents = sum(
    entries.filter((e) => e.kind === 'withdrawal_paid').map((e) => e.amountCents ?? 0),
  );
  return {
    summary: {
      totalDepositedCents,
      totalWithdrawnCents,
      portfolioValueCents: 0,
      netCents: totalDepositedCents - totalWithdrawnCents,
    },
    entries: entries.slice(0, HISTORY_LIMIT),
    truncated: entries.length > HISTORY_LIMIT,
  };
}

export const sampleStatements = {
  parsePeriodKey,
  periodOf,
  listPeriods,
  firstActivity,
  buildStatement,
  toCsv,
  history,
};
