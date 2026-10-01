// The sample world's rows as the platform's routes answer them (src/lib/mobile/views.ts:
// notificationView, investmentView), and the tier rules several routes share
// (src/lib/invest/tiers.ts and settings: capacity, tier order, the effective minimum).
import type {
  AlertView,
  InvestorTier,
  PositionView,
  Strategies,
  TierView,
  Wallet,
} from '../../api/types';
import { positionView, type PositionInput } from '../portfolioMath';
import { planOf, toPositionInput } from '../rows';
import type { SampleAlert, SamplePlan, SamplePosition, SampleState } from '../sampleData';

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => date?.toISOString() ?? null;

const TIERS: readonly InvestorTier[] = ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM', 'ELITE'];
const TIER_LABELS: Record<InvestorTier, string> = {
  STANDARD: 'Standard',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  ELITE: 'Elite',
};
/** How many positions each tier may hold open at once. */
const TIER_CAPACITY: Record<InvestorTier, number> = {
  STANDARD: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  ELITE: 5,
};
/** The statuses that take up a tier's capacity. */
const OPEN_POSITION_STATUSES = new Set(['PENDING', 'ACTIVE', 'MATURED']);

export function tierView(tier: InvestorTier): TierView {
  return { id: tier, label: TIER_LABELS[tier] };
}

export function meetsTier(tier: InvestorTier, required: InvestorTier): boolean {
  return TIERS.indexOf(tier) >= TIERS.indexOf(required);
}

export function capacityFor(state: SampleState): Strategies['capacity'] {
  const used = state.positions.filter((p) => OPEN_POSITION_STATUSES.has(p.status)).length;
  const max = TIER_CAPACITY[state.user.tier];
  return {
    tier: tierView(state.user.tier),
    used,
    max,
    remaining: Math.max(0, max - used),
    allowed: used < max,
  };
}

/** The effective minimum: the larger of the plan's own and the platform's floor. */
export function minimumOf(state: SampleState, plan: SamplePlan): number {
  return Math.max(plan.minimumCents, state.investmentFloorCents);
}

/** The cash ledger's balance: what a cash payout can draw on. */
export function cashBalance(state: SampleState): number {
  return state.ledger.reduce((sum, entry) => sum + entry.amountCents, 0);
}

/** The wallet in `currency`; one is opened, empty, when there is none, as on the platform. */
export function walletFor(state: SampleState, currency: string): Wallet {
  let wallet = state.wallets.find((w) => w.currency === currency);
  if (!wallet) {
    wallet = { currency, availableCents: 0, lockedCents: 0 };
    state.wallets.push(wallet);
  }
  return wallet;
}

export function unreadCount(state: SampleState): number {
  return state.alerts.filter((a) => a.readAt === null).length;
}

/** The newest alerts first. */
export function newestAlerts(state: SampleState, limit: number): SampleAlert[] {
  return [...state.alerts]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export function alertView(a: SampleAlert): AlertView {
  return {
    id: a.id,
    kind: a.kind,
    category: a.category,
    title: a.title,
    body: a.body,
    amountCents: a.amountCents,
    entityType: a.entityType,
    entityId: a.entityId,
    read: a.readAt !== null,
    createdAt: iso(a.createdAt),
  };
}

/** The ACTIVE and MATURED positions, as GET /dashboard values them. */
export function openPositionInputs(state: SampleState): PositionInput[] {
  return state.positions
    .filter((p) => p.status === 'ACTIVE' || p.status === 'MATURED')
    .map((p) => toPositionInput(p, planOf(state, p)));
}

export function positionDto(state: SampleState, p: SamplePosition, now: Date): PositionView {
  const plan = planOf(state, p);
  return {
    id: p.id,
    status: p.status,
    currency: p.currency,
    basis: 'projection',
    plan: {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      symbol: plan.symbol,
      sector: plan.sector,
      assetClass: plan.assetClass,
      projectedReturnPct: plan.projectedReturnPct,
      termMonths: plan.termMonths,
    },
    ...positionView(toPositionInput(p, plan), now),
    startedAt: isoOrNull(p.startedAt),
    maturesAt: isoOrNull(p.maturesAt),
    closedAt: isoOrNull(p.closedAt),
    createdAt: iso(p.createdAt),
    basketRef: p.basketRef,
  };
}
