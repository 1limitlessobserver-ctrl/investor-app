// The Oracle in sample mode, ported from Plan B's helpers/sampleOracle.tsx: it answers the suggested
// questions from the sample portfolio (the same Dashboard and Investments the screens show), and
// says plainly that anything else needs the live connection. Every answer ends with the platform's
// disclaimer (src/lib/ai/oracle.ts), as live answers do.
import type { Dashboard, Investments, OracleAnswer } from '../api/types';

export const ORACLE_SUGGESTIONS = [
  'How is my portfolio allocated?',
  'When does my next position mature?',
  'What happens when a position matures?',
  'How do withdrawals work?',
  'What does “projection” mean here?',
  'How can I keep my account secure?',
] as const;

export const ORACLE_DISCLAIMER =
  '— This response is for educational purposes only and is not personalized financial advice. All investments carry risk, including loss of principal.';

export interface SampleOracleContext {
  brandName: string;
  dashboard: Dashboard;
  investments: Investments;
  now: Date;
}

function money(cents: number, currency = 'USD'): string {
  // Both bounds set: engines before ECMA-402 2023 throw when only the maximum is below the currency's default minimum.
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

function day(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function normalise(question: string): string {
  return question
    .toLowerCase()
    .replace(/[“”"'’?.!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function allocation({ dashboard }: SampleOracleContext): string {
  const slices = dashboard.allocation;
  if (slices.length === 0)
    return 'You have no open positions yet, so there is nothing allocated. Invest from Move → Invest and the split appears on Home.';
  const parts = slices.map((s) => `${s.label} ${s.weightPct.toFixed(1)}% (${money(s.valueCents)})`);
  const open = dashboard.totals.activeCount + dashboard.totals.maturedCount;
  return [
    `Your ${open} open position${open === 1 ? '' : 's'} are spread across ${slices.length} sector${slices.length === 1 ? '' : 's'}: ${parts.join(', ')}.`,
    `Together they come to a projected ${money(dashboard.totals.portfolioValueCents)} at a blended plan rate of ${dashboard.totals.projectedYieldPct.toFixed(1)}% a year.`,
  ].join(' ');
}

function nextMaturity({ investments, now }: SampleOracleContext): string {
  const upcoming = investments.positions
    .filter(
      (p) =>
        p.status === 'ACTIVE' && p.maturesAt && new Date(p.maturesAt).getTime() > now.getTime(),
    )
    .sort((a, b) => new Date(a.maturesAt!).getTime() - new Date(b.maturesAt!).getTime());
  const lines: string[] = [];
  const next = upcoming[0];
  if (next) {
    const days = Math.ceil((new Date(next.maturesAt!).getTime() - now.getTime()) / 86_400_000);
    lines.push(
      `Your next maturity is ${next.plan.name} on ${day(next.maturesAt!)}, ${days} day${days === 1 ? '' : 's'} from now. At its ${next.plan.projectedReturnPct}% plan rate it is projected to reach ${money(next.principalCents + next.termReturnCents, next.currency)}.`,
    );
  } else {
    lines.push(
      'None of your positions is due to mature: there are no active positions with a maturity date ahead.',
    );
  }
  const waiting = investments.maturityChoices;
  if (waiting.length > 0) {
    const first = waiting[0]!;
    lines.push(
      `${waiting.length === 1 ? `${first.planName} has` : `${waiting.length} positions have`} already matured and ${waiting.length === 1 ? 'is' : 'are'} waiting for your choice — reinvest or withdraw in Move before ${day(first.expiresAt)}.`,
    );
  }
  return lines.join(' ');
}

function maturityRules({ brandName }: SampleOracleContext): string {
  return [
    "When a position reaches its maturity date, its principal and the return at the plan's rate are realised and the position shows as Matured.",
    'You then choose what happens to it in Move: reinvest it into a strategy, or withdraw it. The choice stays open for 7 days after maturity.',
    `A withdrawal is reviewed by the ${brandName} team, and you get an alert when it is approved and paid.`,
  ].join(' ');
}

function withdrawals({ dashboard }: SampleOracleContext): string {
  return [
    'There are two kinds. A cash payout draws on your cash balance: Move → Withdraw, then the amount and where it should go.',
    'A matured position can be withdrawn as a whole from the same screen or from the holding itself.',
    `Each request is reviewed before it is paid, and every step arrives as an alert. Your cash balance right now is ${money(dashboard.cash.balanceCents)}.`,
  ].join(' ');
}

function projection({ dashboard }: SampleOracleContext): string {
  return [
    "Figures marked Projection are calculated from each plan's annual rate and the time each position has run — they are not market prices, and nothing is traded to produce them.",
    `Yours show a projected ${money(dashboard.totals.portfolioValueCents)}, of which ${money(dashboard.totals.earningsCents)} is modelled earnings on ${money(dashboard.totals.deployedCents)} deployed.`,
  ].join(' ');
}

function security({ brandName }: SampleOracleContext): string {
  return [
    "Turn on two-step sign-in and set a transfer PIN in Profile → Security, keep the app lock on, and sign out of any session there you don't recognise.",
    `${brandName} never asks for your password, PIN or codes by message or phone.`,
  ].join(' ');
}

const ANSWERS: Record<string, (context: SampleOracleContext) => string> = {
  [normalise(ORACLE_SUGGESTIONS[0])]: allocation,
  [normalise(ORACLE_SUGGESTIONS[1])]: nextMaturity,
  [normalise(ORACLE_SUGGESTIONS[2])]: maturityRules,
  [normalise(ORACLE_SUGGESTIONS[3])]: withdrawals,
  [normalise(ORACLE_SUGGESTIONS[4])]: projection,
  [normalise(ORACLE_SUGGESTIONS[5])]: security,
};

/** The answer text for a question, from the sample portfolio. */
export function sampleOracleText(question: string, context: SampleOracleContext): string {
  const known = ANSWERS[normalise(question)];
  const body = known
    ? known(context)
    : `This is the sample, so the Oracle only answers the suggested questions, from the sample portfolio. Connected to ${context.brandName}, it answers questions about your account and how the platform works.`;
  return `${body}\n\n${ORACLE_DISCLAIMER}`;
}

/** A complete OracleAnswer in the live shape; the sample API passes its conversation and latency. */
export function sampleOracleAnswer(
  question: string,
  context: SampleOracleContext,
  conversationId = 'sample-conversation',
  latencyMs = 0,
): OracleAnswer {
  return {
    conversationId,
    answer: sampleOracleText(question, context),
    model: 'sample',
    latencyMs,
    retrieved: { knowledge: [], conversations: [] },
  };
}
