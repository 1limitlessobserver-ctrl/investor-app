// The sample world the app runs on when no platform URL is configured: one investor (Alex Morgan)
// and everything around them, built relative to `now` so that relative times stay fresh whenever
// the sample is opened. Clearly sample data: no real money, no real person, no deposit detail that
// works (the QR codes encode `sample-…-preview-only` values and every link is example.com).
//
// Ported from Plan B's gen/sampleData.final.tsx with its ids and offsets unchanged, so the
// platform's own output for these rows (__fixtures__/expected.json) applies. The figures the
// screens show are computed from these rows at request time by portfolioMath. Changes from the
// reference: `createState({ now, stress })`; the DTO types of src/api/types.ts; the QR codes are the
// platform's 320 px renders (__fixtures__/qr.json, as GET /deposit/methods serves them); the
// matured Green Bond carries the `closedAt` the platform stamps when a position matures; and the
// state also holds what the sample API keeps (the sample password, two-factor, push subscriptions,
// the Oracle's conversations) and one full statement.
import type {
  BeneficiaryRelationship,
  Brand,
  CashWithdrawalStatus,
  DepositMethod,
  DepositRequestStatus,
  InvestmentStatus,
  InvestorTier,
  KycDocType,
  KycStatus,
  LegacyPlan,
  NotificationCategory,
  NotificationPrefs,
  PositionWithdrawalStatus,
  PushSubscriptionInput,
  StatementDetail,
  TicketStatus,
  TransferStatus,
  Wallet,
} from '../api/types';
import { addMonths } from './rows';
import { sampleStatements } from './sampleStatements';
import qr from './__fixtures__/qr.json';

export interface SamplePlan {
  id: string;
  slug: string;
  name: string;
  summary: string;
  symbol: string | null;
  assetClass: string;
  category: string;
  sector: string | null;
  projectedReturnPct: number;
  termMonths: number;
  riskRating: number;
  flagship: boolean;
  minimumCents: number;
  requiredTier: InvestorTier | null;
  active: boolean;
}

export interface SamplePosition {
  id: string;
  planId: string;
  status: InvestmentStatus;
  currency: string;
  amountCents: number;
  startedAt: Date | null;
  maturesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  basketRef: string | null;
}

/** As the platform keeps one (src/lib/funds/wallet.ts): an executed choice records its action. */
export interface SampleMaturityChoice {
  id: string;
  investmentId: string;
  status: 'PENDING' | 'EXECUTED' | 'EXPIRED';
  action: 'PENDING' | 'REINVEST' | 'WITHDRAW';
  amountCents: number;
  currency: string;
  expiresAt: Date;
}

/** One row of the manual cash ledger (what a cash payout may draw on). */
export interface SampleLedgerEntry {
  id: string;
  date: Date;
  kind:
    | 'deposit'
    | 'withdrawal'
    | 'manual_credit'
    | 'manual_debit'
    | 'adjustment'
    | 'referral_commission';
  description: string;
  /** Signed: money in is positive. */
  amountCents: number;
}

export interface SampleManualDeposit {
  id: string;
  methodId: string;
  methodKind: string;
  methodLabel: string | null;
  amountCents: number;
  reference: string | null;
  status: DepositRequestStatus;
  notes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface SampleCashWithdrawal {
  id: string;
  amountCents: number;
  destination: string | null;
  status: CashWithdrawalStatus;
  notes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface SamplePositionWithdrawal {
  id: string;
  investmentId: string;
  amountCents: number;
  status: PositionWithdrawalStatus;
  notes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

/** Card top-ups credited to the wallet (history "deposit" entries). */
export interface SampleTopUp {
  id: string;
  amountCents: number;
  date: Date;
  label: string;
}

export interface SampleTransfer {
  id: string;
  direction: 'out' | 'in';
  amountCents: number;
  currency: string;
  note: string | null;
  status: TransferStatus;
  createdAt: Date;
  counterparty: { name: string | null; tag: string | null };
}

/** Another sample investor money can be sent to. */
export interface SampleContact {
  name: string;
  tag: string;
  email: string;
}

export interface SampleAlert {
  id: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  amountCents: number | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface SampleTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ id: string; from: 'support' | 'you'; body: string; createdAt: Date }>;
}

export interface SampleSession {
  id: string;
  device: string;
  ipAddress: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

export interface SampleBeneficiary {
  id: string;
  fullName: string;
  relationship: BeneficiaryRelationship;
  /** "YYYY-MM-DD", as it was entered. */
  dateOfBirth: string | null;
  sharePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Identity verification. Whether it is required is the brand's `kyc` switch, as on the platform. */
export interface SampleKyc {
  status: KycStatus;
  submittedAt: Date | null;
  approvedAt: Date | null;
  latest: {
    id: string;
    status: Exclude<KycStatus, 'NONE'>;
    notes: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    docType: KycDocType;
  } | null;
}

export interface SampleState {
  createdAt: Date;
  brand: Brand;
  user: {
    id: string;
    fullName: string;
    email: string;
    tag: string | null;
    emailVerified: boolean;
    tier: InvestorTier;
    memberSince: Date;
    lastLoginAt: Date | null;
    /** What the password-gated actions take: "sample" until the investor changes it. */
    password: string;
    twoFactorEnabled: boolean;
    /** The secret enrolment handed out, until two-factor is enabled with a code. */
    twoFactorSecret: string | null;
    /** The unused backup codes; each one signs in once. */
    backupCodes: string[];
    pin: string | null;
    notificationPrefs: NotificationPrefs;
    closed: boolean;
  };
  /** The global rank shown by the "Projection-based Rank" figure. */
  rank: number | null;
  plans: SamplePlan[];
  positions: SamplePosition[];
  maturityChoices: SampleMaturityChoice[];
  wallets: Wallet[];
  ledger: SampleLedgerEntry[];
  manualDeposits: SampleManualDeposit[];
  cashWithdrawals: SampleCashWithdrawal[];
  positionWithdrawals: SamplePositionWithdrawal[];
  topUps: SampleTopUp[];
  transfers: SampleTransfer[];
  contacts: SampleContact[];
  alerts: SampleAlert[];
  tickets: SampleTicket[];
  sessions: SampleSession[];
  currentSessionId: string;
  depositMethods: DepositMethod[];
  kyc: SampleKyc;
  legacy: {
    revision: number;
    revisionId: string | null;
    updatedAt: Date | null;
    history: Array<{ id: string; revision: number; createdAt: Date }>;
    plan: LegacyPlan | null;
  };
  beneficiaries: SampleBeneficiary[];
  /** The web-push subscriptions the app registered (the platform keeps them per session). */
  pushSubscriptions: PushSubscriptionInput[];
  oracle: {
    conversations: string[];
    /** When each question inside the rate-limit window was asked (epoch ms). */
    askedAt: number[];
  };
  /** The platform floor for an investment, in cents ($5,000). */
  investmentFloorCents: number;
  /** One full statement: the latest complete quarter. */
  statement: StatementDetail;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** `days` (and `hours`) from now; negative is the past. */
function offset(now: Date, days: number, hours = 0): Date {
  return new Date(now.getTime() + days * DAY + hours * HOUR);
}

/** A valid uncompressed P-256 public key (65 bytes, base64url) with no private key anywhere. */
const SAMPLE_VAPID_PUBLIC_KEY =
  'BPQrQfhlzk4mPvkpTTyldOhVJC3Qmoq9EnBEAKkyD5Nxxp_Jzqh4DSKilScSHi_jfhwtvpghMAFEDSg2H6D8O7c';

/** The overflow audit's world (40 characters). */
const STRESS_BRAND_NAME = 'Everest Reserve International Wealth Co.';
const STRESS_BALANCE_CENTS = 1_234_567_890;

const SAMPLE_INSTRUCTIONS =
  "Sample method for the preview — do not send funds. The live app shows the company's own instructions here.";

function samplePlans(): SamplePlan[] {
  return [
    {
      id: 'plan_orbital',
      slug: 'orbital-launch-partners',
      name: 'Orbital Launch Partners',
      summary:
        'Late-stage private allocation across reusable launch and satellite-servicing companies.',
      symbol: 'ORBIT',
      assetClass: 'PRE_IPO',
      category: 'Pre-IPO',
      sector: 'Aerospace',
      projectedReturnPct: 18,
      termMonths: 36,
      riskRating: 4,
      flagship: true,
      minimumCents: 2_500_000,
      requiredTier: null,
      active: true,
    },
    {
      id: 'plan_treasury',
      slug: 'sovereign-treasury-ladder',
      name: 'Sovereign Treasury Ladder',
      summary: 'A twelve-month ladder of short-dated government bills, rolled at maturity.',
      symbol: 'UST',
      assetClass: 'FIXED_INCOME',
      category: 'Fixed income',
      sector: 'Treasury',
      projectedReturnPct: 5.2,
      termMonths: 12,
      riskRating: 1,
      flagship: false,
      minimumCents: 500_000,
      requiredTier: null,
      active: true,
    },
    {
      id: 'plan_evergreen',
      slug: 'evergreen-green-bond',
      name: 'Evergreen Green Bond',
      summary: 'Certified green bonds financing grid-scale storage and efficient transit.',
      symbol: 'GRNB',
      assetClass: 'FIXED_INCOME',
      category: 'Fixed income',
      sector: 'Green Bonds',
      projectedReturnPct: 7.5,
      termMonths: 12,
      riskRating: 1,
      flagship: false,
      minimumCents: 500_000,
      requiredTier: null,
      active: true,
    },
    {
      id: 'plan_helios',
      slug: 'helios-grid-infrastructure',
      name: 'Helios Grid Infrastructure',
      summary: 'Contracted solar and transmission assets with long-term offtake agreements.',
      symbol: 'HELIO',
      assetClass: 'INFRASTRUCTURE',
      category: 'Infrastructure',
      sector: 'Energy',
      projectedReturnPct: 11.5,
      termMonths: 24,
      riskRating: 2,
      flagship: false,
      minimumCents: 1_000_000,
      requiredTier: null,
      active: true,
    },
    {
      id: 'plan_meridian',
      slug: 'meridian-residential-trust',
      name: 'Meridian Residential Trust',
      summary: 'Stabilised multifamily residences in supply-constrained coastal cities.',
      symbol: 'MRT',
      assetClass: 'REAL_ESTATE',
      category: 'Real estate',
      sector: 'Real Estate',
      projectedReturnPct: 9,
      termMonths: 18,
      riskRating: 2,
      flagship: false,
      minimumCents: 1_000_000,
      requiredTier: null,
      active: true,
    },
    {
      id: 'plan_quantum',
      slug: 'quantum-compute-ventures',
      name: 'Quantum Compute Ventures',
      summary:
        'Venture positions in fault-tolerant quantum hardware and error-correction software.',
      symbol: 'QBIT',
      assetClass: 'VENTURE',
      category: 'Venture',
      sector: 'Technology',
      projectedReturnPct: 32,
      termMonths: 48,
      riskRating: 5,
      flagship: false,
      minimumCents: 5_000_000,
      requiredTier: 'PLATINUM',
      active: true,
    },
  ];
}

function samplePositions(now: Date): SamplePosition[] {
  const helios = offset(now, -487, -3);
  const orbital = offset(now, -381, -5);
  const meridian = offset(now, -304, -2);
  const evergreen = addMonths(offset(now, -6, -4), -12);
  const treasury = offset(now, -760, -6);
  // The platform stamps closedAt when a position matures (realizeDueMaturities): an hour after the
  // maturity date here, when the "matured" alert went out.
  const evergreenMatures = addMonths(evergreen, 12);
  return [
    {
      id: 'pos_helios',
      planId: 'plan_helios',
      status: 'ACTIVE',
      currency: 'USD',
      amountCents: 42_000_000,
      startedAt: helios,
      maturesAt: addMonths(helios, 24),
      closedAt: null,
      createdAt: offset(helios, 0, -1),
      basketRef: null,
    },
    {
      id: 'pos_orbital',
      planId: 'plan_orbital',
      status: 'ACTIVE',
      currency: 'USD',
      amountCents: 30_000_000,
      startedAt: orbital,
      maturesAt: addMonths(orbital, 36),
      closedAt: null,
      createdAt: offset(orbital, 0, -1),
      basketRef: null,
    },
    {
      id: 'pos_meridian',
      planId: 'plan_meridian',
      status: 'ACTIVE',
      currency: 'USD',
      amountCents: 18_000_000,
      startedAt: meridian,
      maturesAt: addMonths(meridian, 18),
      closedAt: null,
      createdAt: offset(meridian, 0, -1),
      basketRef: null,
    },
    {
      id: 'pos_evergreen',
      planId: 'plan_evergreen',
      status: 'MATURED',
      currency: 'USD',
      amountCents: 10_000_000,
      startedAt: evergreen,
      maturesAt: evergreenMatures,
      closedAt: offset(evergreenMatures, 0, 1),
      createdAt: offset(evergreen, 0, -1),
      basketRef: null,
    },
    {
      id: 'pos_treasury',
      planId: 'plan_treasury',
      status: 'WITHDRAWN',
      currency: 'USD',
      amountCents: 25_000_000,
      startedAt: treasury,
      maturesAt: addMonths(treasury, 12),
      closedAt: offset(addMonths(treasury, 12), 4),
      createdAt: offset(treasury, 0, -1),
      basketRef: null,
    },
  ];
}

function sampleDepositMethods(): DepositMethod[] {
  return [
    {
      id: 'method_btc',
      kind: 'bitcoin',
      category: 'Cryptocurrency',
      label: 'Bitcoin',
      logoUrl: null,
      network: 'Bitcoin',
      instructions: SAMPLE_INSTRUCTIONS,
      address: 'sample-bitcoin-address-preview-only',
      bankName: null,
      accountHolderName: null,
      accountNumber: null,
      routingNumber: null,
      qrValue: 'sample-bitcoin-address-preview-only',
      qrDataUrl: qr.bitcoin,
    },
    {
      id: 'method_usdc',
      kind: 'ethereum',
      category: 'Cryptocurrency',
      label: 'USDC',
      logoUrl: null,
      network: 'ERC-20',
      instructions: SAMPLE_INSTRUCTIONS,
      address: 'sample-erc20-address-preview-only',
      bankName: null,
      accountHolderName: null,
      accountNumber: null,
      routingNumber: null,
      qrValue: 'sample-erc20-address-preview-only',
      qrDataUrl: qr.erc20,
    },
    {
      id: 'method_wire',
      kind: 'bank',
      category: 'Bank',
      label: 'Bank wire',
      logoUrl: null,
      network: null,
      instructions: SAMPLE_INSTRUCTIONS,
      address: '',
      bankName: 'Sample Bank N.A.',
      accountHolderName: 'Sample Client Funds Account',
      accountNumber: 'SAMPLE-0001234567',
      routingNumber: 'SAMPLE-ROUTING',
      qrValue: 'SAMPLE-0001234567',
      qrDataUrl: qr.bank,
    },
  ];
}

/**
 * A fresh, mutable copy of the sample world, dated relative to `now`. `stress` is the overflow
 * audit's world: a 40-character company name and $12,345,678.90 in the wallet and the cash balance.
 */
function createState(opts: { now?: Date; stress?: boolean } = {}): SampleState {
  const { now = new Date(), stress = false } = opts;
  const positions = samplePositions(now);
  const evergreen = positions.find((p) => p.id === 'pos_evergreen')!;
  const treasury = positions.find((p) => p.id === 'pos_treasury')!;
  const evergreenMatured = evergreen.maturesAt!;
  const treasuryClosed = treasury.closedAt!;
  const payoutCents = 500_000;
  // The approved wire is the cash ledger's only credit; the stress world grows it to the balance.
  const wireCents = stress ? STRESS_BALANCE_CENTS + payoutCents : 1_750_000;

  const world: Omit<SampleState, 'statement'> = {
    createdAt: now,
    brand: {
      apiVersion: 1,
      name: stress ? STRESS_BRAND_NAME : 'Everest Reserve',
      tagline: 'Your wealth should think for itself.',
      accentHex: '#1F9E76',
      logoDataUrl: null,
      defaultTheme: 'orbital',
      themes: ['orbital', 'obsidian', 'ivory', 'aurora', 'verdant', 'aegis'],
      minSupportedAppVersion: '0.0.0',
      features: { kyc: true, deposits: true, oracle: true, support: true },
      stores: { appStore: null, googlePlay: null, androidDirect: null },
      links: {
        website: 'https://example.com/',
        privacy: 'https://example.com/privacy',
        terms: 'https://example.com/terms',
        register: 'https://example.com/register',
        forgotPassword: 'https://example.com/forgot-password',
      },
      support: { email: 'support@example.com', phone: '+1 (555) 000-0000' },
      vapidPublicKey: SAMPLE_VAPID_PUBLIC_KEY,
    },
    user: {
      id: 'sample_user',
      fullName: 'Alex Morgan',
      email: 'alex.morgan@example.com',
      tag: 'alexmorgan',
      emailVerified: true,
      tier: 'ELITE',
      memberSince: offset(now, -812, -7),
      lastLoginAt: offset(now, -1, -9),
      password: 'sample',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      backupCodes: [],
      pin: null,
      notificationPrefs: {
        deposit: true,
        withdrawal: true,
        referral: false,
        support: true,
        kyc: true,
        security: true,
        system: true,
      },
      closed: false,
    },
    rank: 128,
    plans: samplePlans(),
    positions,
    maturityChoices: [
      {
        id: 'choice_evergreen',
        investmentId: 'pos_evergreen',
        status: 'PENDING',
        action: 'PENDING',
        amountCents: 10_000_000,
        currency: 'USD',
        expiresAt: offset(evergreenMatured, 7),
      },
    ],
    wallets: [
      {
        currency: 'USD',
        availableCents: stress ? STRESS_BALANCE_CENTS : 11_845_075,
        lockedCents: 90_000_000,
      },
    ],
    ledger: [
      {
        id: 'led_wire',
        date: offset(now, -63, -2),
        kind: 'deposit',
        description: 'Bank wire · approved deposit',
        amountCents: wireCents,
      },
      {
        id: 'led_payout',
        date: offset(now, -22, -5),
        kind: 'withdrawal',
        description: 'Cash payout · bank wire ending 4410',
        amountCents: -payoutCents,
      },
    ],
    manualDeposits: [
      {
        id: 'dep_btc_pending',
        methodId: 'method_btc',
        methodKind: 'bitcoin',
        methodLabel: 'Bitcoin',
        amountCents: 2_500_000,
        reference: 'sample-tx-7f3a',
        status: 'PENDING',
        notes: null,
        createdAt: offset(now, 0, -3),
        reviewedAt: null,
      },
      {
        id: 'dep_wire',
        methodId: 'method_wire',
        methodKind: 'bank',
        methodLabel: 'Bank wire',
        amountCents: wireCents,
        reference: 'WIRE-20412',
        status: 'APPROVED',
        notes: 'Received in full.',
        createdAt: offset(now, -64, -6),
        reviewedAt: offset(now, -63, -2),
      },
    ],
    cashWithdrawals: [
      {
        id: 'cw_payout',
        amountCents: payoutCents,
        destination: 'Bank wire ending 4410',
        status: 'PAID',
        notes: 'Paid by wire.',
        createdAt: offset(now, -24, -1),
        reviewedAt: offset(now, -22, -5),
      },
    ],
    positionWithdrawals: [
      {
        id: 'pw_treasury',
        investmentId: 'pos_treasury',
        amountCents: 26_300_000,
        status: 'PAID',
        notes: null,
        createdAt: offset(treasuryClosed, -3),
        reviewedAt: treasuryClosed,
      },
    ],
    topUps: [
      {
        id: 'top_card',
        amountCents: 1_000_000,
        date: offset(now, -5, -6),
        label: 'Instant top-up',
      },
      {
        id: 'top_initial',
        amountCents: 115_000_000,
        date: offset(now, -765, -4),
        label: 'Initial funding',
      },
    ],
    transfers: [
      {
        id: 'tr_grace',
        direction: 'out',
        amountCents: 150_000,
        currency: 'USD',
        note: 'Dinner & tickets',
        status: 'COMPLETED',
        createdAt: offset(now, -9, -4),
        counterparty: { name: 'Grace Liu', tag: 'grace' },
      },
      {
        id: 'tr_daniel',
        direction: 'in',
        amountCents: 75_000,
        currency: 'USD',
        note: 'Ski trip share',
        status: 'COMPLETED',
        createdAt: offset(now, -17, -2),
        counterparty: { name: 'Daniel Reyes', tag: 'daniel' },
      },
    ],
    contacts: [
      { name: 'Grace Liu', tag: 'grace', email: 'grace@example.com' },
      { name: 'Daniel Reyes', tag: 'daniel', email: 'daniel@example.com' },
      { name: 'Priya Shah', tag: 'priya', email: 'priya@example.com' },
    ],
    alerts: [
      {
        id: 'al_deposit_requested',
        kind: 'manual_deposit_requested',
        category: 'deposit',
        title: 'Deposit request received',
        body: 'We received your $25,000.00 Bitcoin deposit request. You will get an alert when it is reviewed.',
        amountCents: 2_500_000,
        entityType: 'manualDeposit',
        entityId: 'dep_btc_pending',
        readAt: null,
        createdAt: offset(now, 0, -3),
      },
      {
        id: 'al_support_reply',
        kind: 'support_reply',
        category: 'support',
        title: 'Support replied: Statement for Q3',
        body: 'Hi Alex — the Q3 statement is ready under Portfolio → Statements.',
        amountCents: null,
        entityType: 'supportTicket',
        entityId: 'tk_statement',
        readAt: null,
        createdAt: offset(now, -1, -2),
      },
      {
        id: 'al_matured',
        kind: 'investment_matured',
        category: 'system',
        title: 'Evergreen Green Bond matured',
        body: 'Your $100,000.00 principal is available. Choose to reinvest or withdraw within 7 days of maturity.',
        amountCents: 10_000_000,
        entityType: 'investment',
        entityId: 'pos_evergreen',
        readAt: null,
        createdAt: offset(evergreenMatured, 0, 1),
      },
      {
        id: 'al_topup',
        kind: 'deposit_confirmed',
        category: 'deposit',
        title: 'Top-up confirmed',
        body: '$10,000.00 was added to your wallet.',
        amountCents: 1_000_000,
        entityType: 'paymentOrder',
        entityId: 'top_card',
        readAt: offset(now, -5, -2),
        createdAt: offset(now, -5, -6),
      },
      {
        id: 'al_transfer_sent',
        kind: 'funds_unlocked',
        category: 'deposit',
        title: 'Transfer sent',
        body: 'You sent 1500.00 USD to Grace Liu.',
        amountCents: 150_000,
        entityType: 'Transfer',
        entityId: 'tr_grace',
        readAt: offset(now, -9, -3),
        createdAt: offset(now, -9, -4),
      },
      {
        id: 'al_beneficiary',
        kind: 'beneficiary_updated',
        category: 'security',
        title: 'Beneficiary updated',
        body: 'Jordan Morgan now receives 60% of your estate share.',
        amountCents: null,
        entityType: 'beneficiary',
        entityId: 'ben_jordan',
        readAt: offset(now, -14),
        createdAt: offset(now, -15, -1),
      },
      {
        id: 'al_payout',
        kind: 'withdrawal_approved',
        category: 'withdrawal',
        title: 'Withdrawal paid',
        body: 'Your $5,000.00 cash payout was sent to bank wire ending 4410.',
        amountCents: 500_000,
        entityType: 'manualWithdrawal',
        entityId: 'cw_payout',
        readAt: offset(now, -21),
        createdAt: offset(now, -22, -5),
      },
      {
        id: 'al_tier',
        kind: 'tier_upgrade_approved',
        category: 'system',
        title: 'Welcome to Elite',
        body: 'Your access tier is now Elite: up to five concurrent positions and every strategy unlocked.',
        amountCents: null,
        entityType: 'tierUpgradeRequest',
        entityId: null,
        readAt: offset(now, -40),
        createdAt: offset(now, -41, -3),
      },
    ],
    tickets: [
      {
        id: 'tk_statement',
        subject: 'Statement for Q3',
        status: 'ANSWERED',
        createdAt: offset(now, -2, -6),
        updatedAt: offset(now, -1, -2),
        messages: [
          {
            id: 'msg_1',
            from: 'you',
            body: "Could you confirm when the Q3 statement will be available? I'd like to share it with my accountant.",
            createdAt: offset(now, -2, -6),
          },
          {
            id: 'msg_2',
            from: 'support',
            body: 'Hi Alex — the Q3 statement is ready under Portfolio → Statements. You can share it as a PDF or export the CSV. Reply here if you need anything else.',
            createdAt: offset(now, -1, -2),
          },
        ],
      },
      {
        id: 'tk_beneficiary',
        subject: 'Updating my beneficiary',
        status: 'CLOSED',
        createdAt: offset(now, -16, -3),
        updatedAt: offset(now, -14, -1),
        messages: [
          {
            id: 'msg_3',
            from: 'you',
            body: 'Can I name my spouse as a beneficiary from the app?',
            createdAt: offset(now, -16, -3),
          },
          {
            id: 'msg_4',
            from: 'support',
            body: 'Yes — open Legacy, then Beneficiaries. Shares can total up to 100%; anything left goes to your estate.',
            createdAt: offset(now, -15, -8),
          },
          {
            id: 'msg_5',
            from: 'you',
            body: 'Done, thank you.',
            createdAt: offset(now, -14, -1),
          },
        ],
      },
    ],
    sessions: [
      {
        id: 'sess_phone',
        device: 'iOS app on Alex’s iPhone',
        ipAddress: '203.0.113.24',
        issuedAt: offset(now, 0, -1),
        expiresAt: offset(now, 30, -1),
      },
      {
        id: 'sess_mac',
        device: 'Chrome on macOS',
        ipAddress: '198.51.100.7',
        issuedAt: offset(now, -2, -3),
        expiresAt: offset(now, 28, -3),
      },
      {
        id: 'sess_ipad',
        device: 'Safari on iPad',
        ipAddress: '198.51.100.42',
        issuedAt: offset(now, -9, -8),
        expiresAt: offset(now, 21, -8),
      },
    ],
    currentSessionId: 'sess_phone',
    depositMethods: sampleDepositMethods(),
    kyc: {
      status: 'APPROVED',
      submittedAt: offset(now, -810, -5),
      approvedAt: offset(now, -809, -2),
      latest: {
        id: 'kyc_1',
        status: 'APPROVED',
        notes: null,
        createdAt: offset(now, -810, -5),
        reviewedAt: offset(now, -809, -2),
        docType: 'PASSPORT',
      },
    },
    legacy: { revision: 0, revisionId: null, updatedAt: null, history: [], plan: null },
    beneficiaries: [
      {
        id: 'ben_jordan',
        fullName: 'Jordan Morgan',
        relationship: 'spouse',
        dateOfBirth: '1984-05-12',
        sharePercent: 60,
        createdAt: offset(now, -15, -1),
        updatedAt: offset(now, -15, -1),
      },
    ],
    pushSubscriptions: [],
    oracle: { conversations: [], askedAt: [] },
    investmentFloorCents: 500_000,
  };

  const thisQuarter = sampleStatements.periodOf(now, 'quarterly');
  const lastQuarter = sampleStatements.periodOf(
    new Date(thisQuarter.start.getTime() - 1),
    'quarterly',
  );
  return { ...world, statement: sampleStatements.buildStatement(world, lastQuarter, now) };
}

export const sampleData = { createState };
