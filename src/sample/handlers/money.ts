// Money (deposit/*, withdrawals, transfers, invest, maturity-choice) with the platform's rules, in
// each route's order. Two balances, as on the platform: the cash ledger (`cashBalance`: approved
// manual deposits in, cash payouts out) is what a cash payout draws on; the wallet's
// `availableCents` is what card top-ups and incoming transfers credit and what transfers,
// investing and reinvesting spend (an open position's principal is `lockedCents`).
//
// In the sample, card top-ups are simulated and credited at once (`instant: 'sandbox'`, as the
// platform does without Stripe outside production), transfers complete at once, and requests filed
// for review stay PENDING.
import { z } from 'zod';
import { format } from '../../lib/format';
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
import { positionView } from '../portfolioMath';
import { addMonths, planOf, toPositionInput } from '../rows';
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
/** A position withdrawal in one of these statuses blocks another request for it. */
const IN_FLIGHT = new Set(['PENDING', 'APPROVED', 'PAID']);
const CARD_MINIMUM_CENTS = 1_000;

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

export function requestWithdrawal(ctx: SampleContext, body: unknown): WithdrawalRequest {
  const input = parse(WithdrawBody, body);
  const { state } = ctx;
  const now = ctx.now();
  if (input.kind === 'cash') {
    // Pending payouts do not reserve the balance; the platform checks it again on approval.
    const balance = cashBalance(state);
    if (input.amountCents > balance) {
      fail(
        'insufficient_balance',
        409,
        `Amount exceeds your available manual balance (${format.money(balance)}).`,
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
  // Principal plus the term's projected return, fixed when the request is made.
  const amountCents = positionView(
    toPositionInput(position, planOf(state, position)),
    now,
  ).valueCents;
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
 * Without a choice id, the earliest pending choice. REINVEST opens a position in an active plan
 * with the matured principal from the wallet (no KYC, tier, capacity or minimum gate) and closes
 * the matured one; WITHDRAW files a pending cash payout of the principal, as the platform does.
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
    choice.status = 'REINVESTED';
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
  choice.status = 'WITHDRAWN';
}
