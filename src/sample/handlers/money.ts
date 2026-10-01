// Money (deposit/*, withdrawals, transfers, invest, maturity-choice) with the platform's rules, in
// each route's order. Two balances, as on the platform: the cash ledger (`cashBalance`: approved
// manual deposits in, cash payouts out) is what a cash payout draws on; the wallet's
// `availableCents` is what card top-ups and incoming transfers credit and what transfers,
// investing and reinvesting spend. An open position's principal is `lockedCents`, and returns to
// `availableCents` when the position matures (src/lib/funds/wallet.ts:190-254).
//
// Sources (in .reference/platform):
//   - cash payouts: src/lib/manual-withdrawal.ts:57-113, requestManualWithdrawal;
//   - position withdrawals: src/lib/investments/withdrawals.ts:77-135, requestWithdrawal;
//   - transfers: src/lib/funds/transfers.ts:15-51, sendTransfer's checks;
//   - maturity choices: src/lib/funds/wallet.ts:256-359, executeMaturityChoice;
//   - deposits and investing: src/lib/admin/deposits.ts and src/lib/payments/payments.ts are not
//     staged; their rules and texts are those Plan B's error inventory (mobileErrors.draft.md,
//     sections 4.6, 5.5 and 5.7) records from them.
//
// In the sample, card top-ups are simulated and credited at once (`instant: 'sandbox'`, what the
// platform does without Stripe outside production), transfers complete at once, and requests filed
// for review stay PENDING: there is no administrator to decide them.
import { z } from 'zod';
import type {
  CardDepositResult,
  DepositOverview,
  InvestResult,
  ManualDepositResult,
  TransferResult,
  Transfers,
  WithdrawalRequest,
  Withdrawals,
} from '../../api/types';
import { computeEarnings } from '../portfolioMath';
import { addMonths, planOf } from '../rows';
import type { SamplePlan, SampleState } from '../sampleData';
import type { SampleContext } from './context';
import { AmountCents, fail, parse, requireFeature } from './context';
import {
  capacityFor,
  cashBalance,
  iso,
  isoOrNull,
  meetsTier,
  minimumOf,
  tierView,
  walletFor,
} from './views';

const LISTED = 50;
/** A position withdrawal in one of these statuses blocks another request for it (withdrawals.ts:102-108). */
const IN_FLIGHT = new Set(['PENDING', 'APPROVED', 'PAID']);
const CARD_MINIMUM_CENTS = 1_000;

/**
 * manual-withdrawal.ts's money text (lines 52-55), copied as is: "$12,500.00". Below zero it
 * floors the dollars away from zero ("-$2.50" for -150), a quirk the sample's cash balance, which
 * never goes below zero, does not reach.
 */
function fromCentsDisplay(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.floor(cents / 100)).toLocaleString('en-US')}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

const ManualBody = z.object({
  methodId: z.string().min(1).max(64),
  amountCents: AmountCents,
  reference: z.string().trim().max(500).optional(),
});
const CardBody = z.object({ amountCents: AmountCents });
const WithdrawBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cash'),
    amountCents: AmountCents,
    destination: z.string().trim().max(500).optional(),
  }),
  z.object({ kind: z.literal('position'), investmentId: z.string().min(1).max(64) }),
]);
const SendBody = z.object({
  recipient: z.string().trim().min(2).max(200),
  amountCents: AmountCents,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code.')
    .default('USD'),
  note: z.string().trim().max(200).optional(),
  pin: z.string().regex(/^\d{4,8}$/, 'Enter your 4 to 8 digit PIN.'),
});
const InvestBody = z.object({ planId: z.string().min(1).max(64), amountCents: AmountCents });
const ChoiceBody = z.object({
  choiceId: z.string().min(1).max(64).optional(),
  choice: z.enum(['REINVEST', 'WITHDRAW']),
  planId: z.string().min(1).max(64).optional(),
});

const newestFirst = <T extends { createdAt: Date }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

/** A new ACTIVE position, paid from the wallet: its principal moves to `lockedCents`. */
function openPosition(ctx: SampleContext, plan: SamplePlan, amountCents: number): void {
  const now = ctx.now();
  const wallet = walletFor(ctx.state, 'USD');
  wallet.availableCents -= amountCents;
  wallet.lockedCents += amountCents;
  ctx.state.positions.push({
    id: ctx.newId('pos'),
    planId: plan.id,
    status: 'ACTIVE',
    currency: 'USD',
    amountCents,
    startedAt: now,
    maturesAt: addMonths(now, plan.termMonths),
    closedAt: null,
    createdAt: now,
    basketRef: null,
  });
}

export function depositMethods(ctx: SampleContext): DepositOverview {
  requireFeature(ctx, 'deposits');
  const { state } = ctx;
  return {
    instant: 'sandbox',
    cashBalanceCents: cashBalance(state),
    methods: state.depositMethods,
    requests: newestFirst(state.manualDeposits)
      .slice(0, LISTED)
      .map((r) => ({
        id: r.id,
        methodKind: r.methodKind,
        methodLabel: r.methodLabel,
        amountCents: r.amountCents,
        reference: r.reference,
        status: r.status,
        notes: r.notes,
        createdAt: iso(r.createdAt),
        reviewedAt: isoOrNull(r.reviewedAt),
      })),
  };
}

export function manualDeposit(ctx: SampleContext, body: unknown): ManualDepositResult {
  requireFeature(ctx, 'deposits');
  const input = parse(ManualBody, body);
  const method = ctx.state.depositMethods.find((m) => m.id === input.methodId);
  if (!method) fail('method_unavailable', 404, 'Deposit method is not available.');
  const id = ctx.newId('dep');
  ctx.state.manualDeposits.unshift({
    id,
    methodId: method.id,
    methodKind: method.kind,
    methodLabel: method.label,
    amountCents: input.amountCents,
    reference: input.reference || null,
    status: 'PENDING',
    notes: null,
    createdAt: ctx.now(),
    reviewedAt: null,
  });
  return {
    id,
    amountCents: input.amountCents,
    methodLabel: method.label,
    address: method.address,
    status: 'PENDING',
  };
}

export function cardDeposit(ctx: SampleContext, body: unknown): CardDepositResult {
  requireFeature(ctx, 'deposits');
  const { amountCents } = parse(CardBody, body);
  if (amountCents < CARD_MINIMUM_CENTS) {
    fail('below_minimum', 400, 'Minimum instant deposit is $10');
  }
  const { state } = ctx;
  walletFor(state, 'USD').availableCents += amountCents;
  const orderId = ctx.newId('ord');
  state.topUps.unshift({ id: orderId, amountCents, date: ctx.now(), label: 'Instant top-up' });
  return {
    kind: 'simulated',
    url: new URL('/app/return?status=success', state.brand.links.website).toString(),
    orderId,
  };
}

export function withdrawals(ctx: SampleContext): Withdrawals {
  const { state } = ctx;
  return {
    cashBalanceCents: cashBalance(state),
    cash: newestFirst(state.cashWithdrawals)
      .slice(0, LISTED)
      .map((w) => ({
        id: w.id,
        amountCents: w.amountCents,
        destination: w.destination,
        status: w.status,
        notes: w.notes,
        createdAt: iso(w.createdAt),
        reviewedAt: isoOrNull(w.reviewedAt),
      })),
    positions: newestFirst(state.positionWithdrawals).flatMap((w) => {
      const position = state.positions.find((p) => p.id === w.investmentId);
      if (!position) return [];
      return [
        {
          id: w.id,
          investmentId: w.investmentId,
          planName: planOf(state, position).name,
          amountCents: w.amountCents,
          status: w.status,
          notes: w.notes,
          createdAt: iso(w.createdAt),
          reviewedAt: isoOrNull(w.reviewedAt),
        },
      ];
    }),
  };
}

/**
 * A cash payout, as requestManualWithdrawal files it (manual-withdrawal.ts:57-113): at most the
 * current cash balance, or 409 `insufficient_balance`. A pending payout does not reserve the
 * balance; the platform checks it again when an administrator approves (lines 227-258).
 *
 * Or the withdrawal of a matured position, as requestWithdrawal files it (withdrawals.ts:77-135):
 * the investor's, MATURED and dated, with no request for it PENDING, APPROVED or PAID (a REJECTED
 * one may be asked for again); the amount, principal plus the term's realized earnings, is fixed
 * when the request is made.
 */
export function requestWithdrawal(ctx: SampleContext, body: unknown): WithdrawalRequest {
  const input = parse(WithdrawBody, body);
  const { state } = ctx;
  const now = ctx.now();
  if (input.kind === 'cash') {
    const balance = cashBalance(state);
    if (input.amountCents > balance) {
      fail(
        'insufficient_balance',
        409,
        `Amount exceeds your available manual balance (${fromCentsDisplay(balance)}).`,
      );
    }
    const id = ctx.newId('cw');
    state.cashWithdrawals.unshift({
      id,
      amountCents: input.amountCents,
      destination: input.destination || null,
      status: 'PENDING',
      notes: null,
      createdAt: now,
      reviewedAt: null,
    });
    return { kind: 'cash', id, amountCents: input.amountCents, status: 'PENDING' };
  }
  const position = state.positions.find((p) => p.id === input.investmentId);
  if (!position) fail('investment_not_found', 404, 'investment not found');
  if (position.status !== 'MATURED') {
    fail('not_matured', 409, 'Only matured positions can be withdrawn');
  }
  if (!position.startedAt || !position.maturesAt) {
    fail('not_matured', 409, 'Investment is missing maturity dates');
  }
  if (
    state.positionWithdrawals.some((w) => w.investmentId === position.id && IN_FLIGHT.has(w.status))
  ) {
    fail('withdrawal_pending', 409, 'A withdrawal is already in progress for this position');
  }
  const plan = planOf(state, position);
  const principalCents = position.amountCents;
  const earnings = computeEarnings({
    amountCents: principalCents,
    projectedReturnPct: plan.projectedReturnPct,
    termMonths: plan.termMonths,
    startedAt: position.startedAt,
    maturesAt: position.maturesAt,
    status: position.status,
    now,
  });
  const amountCents = principalCents + earnings.realizedCents;
  const id = ctx.newId('pw');
  state.positionWithdrawals.unshift({
    id,
    investmentId: position.id,
    amountCents,
    status: 'PENDING',
    notes: null,
    createdAt: now,
    reviewedAt: null,
  });
  return { kind: 'position', id, amountCents, status: 'PENDING' };
}

/** The latest 50 sent and 50 received, newest first; counterparties by name and $tag only. */
export function transfers(ctx: SampleContext): Transfers {
  const { state } = ctx;
  const sorted = newestFirst(state.transfers);
  const listed = [
    ...sorted.filter((t) => t.direction === 'out').slice(0, LISTED),
    ...sorted.filter((t) => t.direction === 'in').slice(0, LISTED),
  ];
  return {
    wallets: state.wallets.map((w) => ({
      currency: w.currency,
      availableCents: w.availableCents,
      lockedCents: w.lockedCents,
    })),
    transfers: newestFirst(listed).map((t) => ({
      id: t.id,
      direction: t.direction,
      amountCents: t.amountCents,
      currency: t.currency,
      note: t.note,
      status: t.status,
      createdAt: iso(t.createdAt),
      counterparty: { name: t.counterparty.name, tag: t.counterparty.tag },
    })),
  };
}

/** A recipient starting with "$" or "@" is a tag, anything else an email; both lower-cased. */
function resolveRecipient(state: SampleState, recipient: string) {
  const isTag = recipient.startsWith('$') || recipient.startsWith('@');
  const handle = (isTag ? recipient.slice(1) : recipient).toLowerCase();
  const self = isTag
    ? handle === state.user.tag?.toLowerCase()
    : handle === state.user.email.toLowerCase();
  const contact = state.contacts.find((c) =>
    isTag ? c.tag.toLowerCase() === handle : c.email.toLowerCase() === handle,
  );
  return { self, contact };
}

/**
 * The route's PIN rule (transfers/route.ts), then sendTransfer's checks (transfers.ts:31-51): the
 * recipient by $tag, @tag or email, lower-cased; not the sender; enough available in the wallet of
 * that currency. The platform finds the recipient before it compares it with the sender; the
 * sender always exists, so checking the sender first gives the same answers. A blank note is kept
 * as none here, where the platform stores it as an empty string (line 73).
 */
export function sendTransfer(ctx: SampleContext, body: unknown): TransferResult {
  const input = parse(SendBody, body);
  const { state } = ctx;
  if (state.user.pin === null) fail('pin_required', 409, 'Set a transfer PIN in Security first.');
  if (input.pin !== state.user.pin) fail('invalid_pin', 403, 'PIN is incorrect.');
  const { self, contact } = resolveRecipient(state, input.recipient);
  if (self) fail('self_transfer', 400, 'You cannot send funds to yourself.');
  if (!contact) fail('recipient_not_found', 404, 'Recipient not found.');
  // A currency without a wallet counts as an empty one, which the platform opens as it checks.
  const wallet = walletFor(state, input.currency);
  if (wallet.availableCents < input.amountCents) {
    fail('insufficient_funds', 400, 'Insufficient available funds.');
  }
  wallet.availableCents -= input.amountCents;
  const id = ctx.newId('tr');
  state.transfers.unshift({
    id,
    direction: 'out',
    amountCents: input.amountCents,
    currency: input.currency,
    note: input.note || null,
    status: 'COMPLETED',
    createdAt: ctx.now(),
    counterparty: { name: contact.name, tag: contact.tag },
  });
  return { id, amountCents: input.amountCents, currency: input.currency, status: 'COMPLETED' };
}

export function invest(ctx: SampleContext, body: unknown): InvestResult {
  const input = parse(InvestBody, body);
  const { state } = ctx;
  const capacity = capacityFor(state);
  if (!capacity.allowed) {
    fail(
      'investment_limit_reached',
      403,
      `Your access tier allows up to ${capacity.max} concurrent investment${capacity.max === 1 ? '' : 's'}. Withdraw a matured position or request a tier upgrade to add more.`,
    );
  }
  if (state.brand.features.kyc && state.kyc.status !== 'APPROVED') {
    fail('kyc_required', 403, 'KYC verification required to invest');
  }
  const plan = state.plans.find((p) => p.id === input.planId);
  if (!plan) fail('plan_unavailable', 404, 'Plan not found');
  if (!plan.active) fail('plan_unavailable', 404, 'Plan not available');
  if (plan.requiredTier && !meetsTier(state.user.tier, plan.requiredTier)) {
    fail(
      'tier_required',
      403,
      `${plan.name} is reserved for ${tierView(plan.requiredTier).label} tier and above — a benefit for our most loyal clients. Request a tier upgrade to unlock it.`,
    );
  }
  if (input.amountCents < minimumOf(state, plan)) {
    fail('below_minimum', 400, 'Amount below the minimum for this offering');
  }
  if (walletFor(state, 'USD').availableCents < input.amountCents) {
    fail('insufficient_funds', 400, 'Insufficient available funds');
  }
  openPosition(ctx, plan, input.amountCents);
  return { kind: 'wallet', orderId: ctx.newId('ord'), url: null };
}

/**
 * The platform's executeMaturityChoice (wallet.ts:261-359), on the earliest pending choice when no
 * id is given (maturity-choice/route.ts). Either way the choice becomes EXECUTED with its action.
 *
 * REINVEST (lines 282-322) opens an ACTIVE position in an active plan with the matured principal,
 * paid from the wallet's available balance (no KYC, tier, capacity or minimum gate).
 *
 * WITHDRAW (lines 323-346) files a PENDING cash payout of the principal, with no check against the
 * cash balance, and leaves the position MATURED. The principal is not moved: it stays in the
 * wallet's available balance, where it returned at maturity ("Your matured capital is in your
 * available balance and a withdrawal request has been submitted for admin review", lines 349-358).
 *
 * The sample's one departure: REINVEST also closes the matured position (WITHDRAWN). wallet.ts
 * leaves it MATURED, which would count its principal twice beside the new position.
 */
export function maturityChoice(ctx: SampleContext, body: unknown): void {
  const input = parse(ChoiceBody, body);
  const { state } = ctx;
  const choice =
    input.choiceId === undefined
      ? state.maturityChoices
          .filter((c) => c.status === 'PENDING')
          .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())[0]
      : state.maturityChoices.find((c) => c.id === input.choiceId);
  if (!choice) {
    fail(
      'not_found',
      404,
      input.choiceId === undefined
        ? 'No maturity choice is waiting.'
        : 'Maturity choice not found.',
    );
  }
  if (choice.status !== 'PENDING') fail('already_executed', 409, 'Choice already executed.');
  const position = state.positions.find((p) => p.id === choice.investmentId);
  if (!position) fail('not_found', 404, 'Maturity choice not found.');
  const now = ctx.now();
  if (input.choice === 'REINVEST') {
    if (!input.planId) fail('missing_plan', 400, 'Target plan required to reinvest.');
    const plan = state.plans.find((p) => p.id === input.planId && p.active);
    if (!plan) fail('plan_unavailable', 400, 'Plan not available.');
    if (walletFor(state, position.currency).availableCents < position.amountCents) {
      fail('insufficient_funds', 400, 'Insufficient available funds to reinvest.');
    }
    openPosition(ctx, plan, position.amountCents);
    position.status = 'WITHDRAWN';
    position.closedAt = now;
    choice.status = 'EXECUTED';
    choice.action = 'REINVEST';
    return;
  }
  state.cashWithdrawals.unshift({
    id: ctx.newId('cw'),
    amountCents: position.amountCents,
    destination: null,
    status: 'PENDING',
    notes: null,
    createdAt: now,
    reviewedAt: null,
  });
  choice.status = 'EXECUTED';
  choice.action = 'WITHDRAW';
}
