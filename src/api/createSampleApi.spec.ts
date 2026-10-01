import { describe, it, expect, vi } from 'vitest';
import expected from '../sample/__fixtures__/expected.json';
import { sampleData } from '../sample/sampleData';
import { ORACLE_SUGGESTIONS } from '../sample/sampleOracle';
import { legacyPlanModel } from '../lib/legacyPlanModel';
import { createSampleApi, createSampleApiFor } from './createSampleApi';
import { MobileApiError } from './MobileApiError';
import type { KycSubmission, NotificationPrefs } from './types';

async function failure(p: Promise<unknown>): Promise<MobileApiError> {
  try {
    await p;
  } catch (e) {
    if (MobileApiError.is(e)) return e;
    throw e;
  }
  throw new Error('expected a MobileApiError');
}
const api = () => createSampleApi({ latencyMs: 0 });
// Vitest types its asymmetric matchers as `any`; typed once here, the expected shapes stay typed.
const anyString = expect.any(String) as string;
const anyArray = expect.any(Array) as string[];

function base64url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

const kyc: KycSubmission = {
  legalName: 'Alex Morgan',
  dob: '1988-03-14',
  country: 'GB',
  nationality: 'GB',
  taxCountry: 'GB',
  taxId: 'AB123456C',
  docType: 'PASSPORT',
  docReference: '123456789',
  street1: '12 Analytical Row',
  city: 'London',
  state: 'Greater London',
  postalCode: 'NW1 6XE',
  employmentStatus: 'Employed',
  sourceOfFunds: 'Employment income',
  annualIncome: '$100,000 – $250,000',
  investmentExperience: 'Good (2–5 years)',
};

describe('createSampleApi', () => {
  it('serves a brand and a dashboard in sample mode', async () => {
    const a = api();
    expect(a.mode).toBe('sample');
    const brand = await a.brand();
    expect(brand.name.length).toBeGreaterThan(0);
    expect(brand.themes).toContain('orbital');
    expect(brand.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    // A real uncompressed P-256 point (87 base64url characters), so a browser accepts it.
    expect(brand.vapidPublicKey).toHaveLength(87);
    const key = crypto.subtle.importKey(
      'raw',
      base64url(brand.vapidPublicKey!),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    await expect(key).resolves.toBeDefined();
    const d = await a.dashboard();
    expect(d.totals.portfolioValueCents).toBeGreaterThan(0);
    expect(d.performance.basis).toBe('projection');
  });
  it('signs in with any email and asks for the second factor on +2fa', async () => {
    const a = api();
    const plain = await a.login({ email: 'anyone@example.com', password: 'x' });
    expect(plain.requiresTwoFactor).toBe(false);
    const step = await a.login({ email: 'investor+2fa@sample.app', password: 'anything' });
    expect(step.requiresTwoFactor).toBe(true);
    if (!step.requiresTwoFactor) return;
    expect(
      (await failure(a.loginTwoFactor({ challenge: step.challenge, code: '000000' }))).code,
    ).toBe('invalid_code');
    expect((await a.loginTwoFactor({ challenge: step.challenge, code: '123456' })).tokenType).toBe(
      'Bearer',
    );
  });
  it('files a manual deposit as pending and lists it', async () => {
    const a = api();
    const methods = await a.depositMethods();
    const res = await a.manualDeposit({
      methodId: methods.methods[0]!.id,
      amountCents: 50000,
      reference: 'tx-1',
    });
    expect(res.status).toBe('PENDING');
    expect((await a.depositMethods()).requests[0]).toEqual(
      expect.objectContaining({ id: res.id, amountCents: 50000, status: 'PENDING' }),
    );
  });
  it('needs a PIN to send money and refuses a wrong one', async () => {
    const a = api();
    expect(
      (await failure(a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '1234' }))).code,
    ).toBe('pin_required');
    await a.setPin({ currentPassword: 'sample', pin: '2468' });
    const wrong = await failure(
      a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '1111' }),
    );
    expect([wrong.code, wrong.status]).toEqual(['invalid_pin', 403]);
    expect(
      (await a.sendTransfer({ recipient: '$grace', amountCents: 1000, pin: '2468' })).status,
    ).toBe('COMPLETED');
  });
  it('marks an alert read and lowers the unread count', async () => {
    const a = api();
    const before = await a.notifications();
    const unread = before.notifications.find((n) => !n.read)!;
    expect((await a.markRead(unread.id)).unreadCount).toBe(before.unreadCount - 1);
    expect((await a.markRead()).unreadCount).toBe(0);
  });
  it('keeps beneficiary shares within 100%', async () => {
    const a = api();
    const { summary } = await a.beneficiaries();
    const e = await failure(
      a.addBeneficiary({
        fullName: 'Too Much',
        relationship: 'other',
        sharePercent: summary.remainder + 1,
      }),
    );
    expect([e.code, e.status]).toEqual(['share_exceeds_100', 409]);
  });
  it('refuses a cash withdrawal above the cash balance', async () => {
    const a = api();
    const { cashBalanceCents } = await a.withdrawals();
    expect(
      (await failure(a.requestWithdrawal({ kind: 'cash', amountCents: cashBalanceCents + 1 })))
        .code,
    ).toBe('insufficient_balance');
  });
  // Adjusted to Task 4's types (ruling 2):
  //   - GET /strategies answers `{ strategies, capacity: { tier, used, max, remaining, allowed }, kyc }`:
  //     the room for another position is one top-level `capacity`, not a `capacity` on each strategy,
  //     so the test checks `capacity.remaining > 0` and picks `strategies.find(s => s.unlocked)`.
  //   - Investing spends the wallet: `Dashboard.cash.wallets[].availableCents` ("transfers and
  //     investing spend a wallet's availableCents, not the cash balance"), so that is the figure
  //     that drops by the amount; `cash.balanceCents` is the cash ledger and stays as it was.
  it('invests from the wallet and keeps the dashboard consistent', async () => {
    const a = api();
    const before = await a.dashboard();
    const { strategies, capacity } = await a.strategies();
    expect(capacity.remaining).toBeGreaterThan(0);
    const open = strategies.find((s) => s.unlocked)!;
    await a.invest({ planId: open.id, amountCents: open.minimumCents });
    const after = await a.dashboard();
    expect(after.cash.wallets[0]!.availableCents).toBe(
      before.cash.wallets[0]!.availableCents - open.minimumCents,
    );
    expect(after.cash.balanceCents).toBe(before.cash.balanceCents);
    expect((await a.investments()).positions.length).toBe(
      (await api().investments()).positions.length + 1,
    );
  });
  it('accepts a push subscription and an unsubscribe', async () => {
    const a = api();
    await expect(
      a.pushSubscribe({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'p', auth: 'a' },
        platform: 'web',
      }),
    ).resolves.toBeUndefined();
    await expect(a.pushUnsubscribe('https://push.example/abc')).resolves.toBeUndefined();
  });
  it('exposes a stress world for the overflow audit', async () => {
    const a = createSampleApi({ latencyMs: 0, stress: true });
    expect((await a.brand()).name.length).toBe(40);
    const d = await a.dashboard();
    expect(d.cash.balanceCents).toBe(1234567890);
    expect(d.cash.wallets[0]!.availableCents).toBe(1234567890);
  });
});

describe('createSampleApi: the platform’s rules in the sample world', () => {
  it('waits the latency before answering', async () => {
    vi.useFakeTimers();
    try {
      const a = createSampleApi({ latencyMs: 450 });
      let settled = false;
      void a.dashboard().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(449);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the minimum app version it was given', async () => {
    expect((await api().brand()).minSupportedAppVersion).toBe('1.0.0');
    const old = createSampleApi({ latencyMs: 0, minSupportedAppVersion: '99.0.0' });
    expect((await old.brand()).minSupportedAppVersion).toBe('99.0.0');
  });

  it('ends the session on _test_revoke and keeps the public routes until the next sign-in', async () => {
    const a = api();
    a._test_revoke();
    for (const call of [() => a.me(), () => a.dashboard(), () => a.refresh()]) {
      const e = await failure(call());
      expect([e.code, e.status]).toEqual(['session_revoked', 401]);
    }
    // Signing out always succeeds: POST /auth/logout answers { ok: true } whatever the tokens.
    await expect(a.logout()).resolves.toBeUndefined();
    await expect(a.brand()).resolves.toMatchObject({ apiVersion: 1 });
    expect((await a.login({ email: 'anyone@example.com', password: 'x' })).requiresTwoFactor).toBe(
      false,
    );
    await expect(a.me()).resolves.toMatchObject({ fullName: 'Alex Morgan' });
  });

  it('computes the dashboard from the rows with the platform’s functions', async () => {
    const now = new Date(expected.now);
    const d = await createSampleApi({ latencyMs: 0, now: () => now }).dashboard();
    expect(d.asOf).toBe(expected.now);
    expect(d.user).toEqual({
      firstName: 'Alex',
      tier: { id: 'ELITE', label: 'Elite' },
      kycStatus: 'APPROVED',
    });
    expect(d.totals).toEqual({ basis: 'projection', ...expected.aggregates });
    expect(d.kpis).toEqual(expected.kpis);
    expect(d.allocation).toEqual(expected.allocation);
    expect(d.performance.points).toHaveLength(expected.series.length);
    expect(d.performance.points[11]).toEqual(expected.series.middle);
    expect(d.nextSteps.map((s) => s.id)).toEqual(expected.nextSteps);
    expect(d.cash).toEqual({
      balanceCents: 1_250_000,
      wallets: [{ currency: 'USD', availableCents: 11_845_075, lockedCents: 90_000_000 }],
    });
    expect(d.alerts.unreadCount).toBe(3);
    expect(d.alerts.latest.map((n) => n.id)).toEqual([
      'al_deposit_requested',
      'al_support_reply',
      'al_topup',
      'al_matured',
      'al_transfer_sent',
    ]);
  });

  it('answers copies, so no caller holds a piece of the sample world', async () => {
    const a = api();
    const me = await a.me();
    me.notificationPrefs.deposit = false;
    const brand = await a.brand();
    brand.features.deposits = false;
    expect((await a.me()).notificationPrefs.deposit).toBe(true);
    expect((await a.brand()).features.deposits).toBe(true);
  });

  it('rounds the blended yield to one decimal, as GET /dashboard does', async () => {
    const state = sampleData.createState();
    state.plans.find((p) => p.id === 'plan_helios')!.projectedReturnPct = 11.57;
    const d = await createSampleApiFor(state, { latencyMs: 0 }).dashboard();
    expect([d.totals.projectedYieldPct, d.kpis[2]?.value]).toEqual([12.6, '12.6%']);
  });

  it('lists the active strategies flagship first, then by rising risk', async () => {
    expect((await api().strategies()).strategies.map((s) => s.id)).toEqual([
      'plan_orbital',
      'plan_treasury',
      'plan_evergreen',
      'plan_helios',
      'plan_meridian',
      'plan_quantum',
    ]);
    const state = sampleData.createState();
    state.plans.reverse();
    state.plans.find((p) => p.id === 'plan_quantum')!.active = false;
    state.plans.find((p) => p.id === 'plan_treasury')!.minimumCents = 100_000; // below the floor
    const a = createSampleApiFor(state, { latencyMs: 0 });
    const { strategies } = await a.strategies();
    expect(strategies.map((s) => [s.id, s.minimumCents])).toEqual([
      ['plan_orbital', 2_500_000],
      ['plan_evergreen', 500_000],
      ['plan_treasury', 500_000],
      ['plan_meridian', 1_000_000],
      ['plan_helios', 1_000_000],
    ]);
    const closed = await failure(a.invest({ planId: 'plan_quantum', amountCents: 5_000_000 }));
    expect([closed.code, closed.status, closed.message]).toEqual([
      'plan_unavailable',
      404,
      'Plan not available',
    ]);
  });

  it('opens tickets newest activity first and reopens one on a reply', async () => {
    let clock = Date.parse('2026-10-01T12:00:00.000Z');
    const a = createSampleApi({ latencyMs: 0, now: () => new Date(clock) });
    const { id } = await a.openTicket({
      subject: '  Statement question ',
      message: 'Where is it?',
    });
    clock += 60_000;
    const list = await a.supportTickets();
    expect([
      list.page,
      list.pageSize,
      list.total,
      list.tickets[0]?.id,
      list.tickets[0]?.subject,
    ]).toEqual([1, 20, 3, id, 'Statement question']);
    await a.replyTicket({ id: 'tk_beneficiary', message: 'One more question.' });
    const thread = await a.ticket('tk_beneficiary');
    expect(thread.status).toBe('OPEN');
    expect(thread.messages.at(-1)).toMatchObject({ from: 'you', body: 'One more question.' });
    expect((await a.supportTickets()).tickets[0]?.id).toBe('tk_beneficiary');
    expect((await a.supportTickets(2)).tickets).toEqual([]);
  });

  it('files a pending payout of the principal when a matured position is withdrawn', async () => {
    const a = api();
    const before = await a.withdrawals();
    await a.maturityChoice({ choice: 'WITHDRAW' });
    const after = await a.withdrawals();
    expect(after.cash).toHaveLength(before.cash.length + 1);
    expect(after.cash[0]).toMatchObject({ amountCents: 10_000_000, status: 'PENDING' });
    expect(after.cashBalanceCents).toBe(before.cashBalanceCents);
    expect((await a.investments()).maturityChoices).toEqual([]);
    expect((await a.dashboard()).nextSteps.map((s) => s.title)).toEqual([
      '2 requests under review',
      'Design your legacy plan',
    ]);
  });

  it('checks the sample password and refuses to close while capital is deployed', async () => {
    const a = api();
    const wrong = await failure(a.closeAccount({ currentPassword: 'not-it' }));
    expect([wrong.code, wrong.status, wrong.message]).toEqual([
      'current_incorrect',
      403,
      'Current password is incorrect.',
    ]);
    const held = await failure(a.closeAccount({ currentPassword: 'sample' }));
    expect([held.code, held.status, held.message, held.detail]).toEqual([
      'active_holdings',
      409,
      'Close your active positions first.',
      ['4'],
    ]);
    for (const call of [
      () => a.setPin({ currentPassword: 'x', pin: '2468' }),
      () => a.changePassword({ currentPassword: 'x', newPassword: 'N3w-password!!' }),
      () => a.enrollTwoFactor({ currentPassword: 'x' }),
      () => a.disableTwoFactor({ currentPassword: 'x' }),
    ]) {
      expect((await failure(call())).code).toBe('current_incorrect');
    }
  });

  it('turns a closed account away at sign-in', async () => {
    const state = sampleData.createState();
    state.positions = []; // nothing deployed, so the account may close
    const a = createSampleApiFor(state, { latencyMs: 0 });
    await expect(a.closeAccount({ currentPassword: 'sample' })).resolves.toBeUndefined();
    expect((await failure(a.me())).code).toBe('session_revoked');
    await expect(a.logout()).resolves.toBeUndefined();
    const refused = await failure(
      a.login({ email: 'alex.morgan@example.com', password: 'sample' }),
    );
    expect([refused.code, refused.status, refused.message]).toEqual([
      'invalid_credentials',
      401,
      'The email or password is incorrect.',
    ]);
  });

  it('answers 404 for what does not exist', async () => {
    const a = api();
    for (const [call, code] of [
      [() => a.investment('pos_nope'), 'not_found'],
      [() => a.ticket('tk_nope'), 'not_found'],
      [() => a.replyTicket({ id: 'tk_nope', message: 'Hello' }), 'ticket_not_found'],
      [() => a.maturityChoice({ choiceId: 'choice_nope', choice: 'WITHDRAW' }), 'not_found'],
      [() => a.removeBeneficiary('ben_nope'), 'beneficiary_not_found'],
      [() => a.revokeSession('sess_nope'), 'session_not_found'],
      [
        () => a.manualDeposit({ methodId: 'method_nope', amountCents: 5_000 }),
        'method_unavailable',
      ],
      [() => a.invest({ planId: 'plan_nope', amountCents: 500_000 }), 'plan_unavailable'],
      [
        () => a.requestWithdrawal({ kind: 'position', investmentId: 'pos_nope' }),
        'investment_not_found',
      ],
    ] as const) {
      const e = await failure(call());
      expect([e.code, e.status]).toEqual([code, 404]);
    }
  });

  it('asks for approved identity to invest', async () => {
    const a = api();
    expect(await a.submitKyc(kyc)).toEqual({ submissionId: anyString, status: 'PENDING' });
    expect(await a.kyc()).toMatchObject({
      status: 'PENDING',
      canSubmit: false,
      latest: { status: 'PENDING' },
    });
    expect((await failure(a.submitKyc(kyc))).code).toBe('kyc_pending');
    expect((await a.strategies()).kyc).toEqual({ required: true, approved: false });
    const e = await failure(a.invest({ planId: 'plan_treasury', amountCents: 500_000 }));
    expect([e.code, e.status, e.message]).toEqual([
      'kyc_required',
      403,
      'KYC verification required to invest',
    ]);
    expect((await a.dashboard()).nextSteps[0]?.id).toBe('kyc_pending');
  });

  it('counts the tier’s concurrent positions and gates premium strategies', async () => {
    const gold = sampleData.createState();
    gold.user.tier = 'GOLD';
    const full = createSampleApiFor(gold, { latencyMs: 0 });
    expect((await full.strategies()).capacity).toEqual({
      tier: { id: 'GOLD', label: 'Gold' },
      used: 4,
      max: 3,
      remaining: 0,
      allowed: false,
    });
    const limit = await failure(full.invest({ planId: 'plan_treasury', amountCents: 500_000 }));
    expect([limit.code, limit.status, limit.message]).toEqual([
      'investment_limit_reached',
      403,
      'Your access tier allows up to 3 concurrent investments. Withdraw a matured position or request a tier upgrade to add more.',
    ]);
    const roomy = sampleData.createState();
    roomy.user.tier = 'GOLD';
    roomy.positions = roomy.positions.filter((p) => p.id === 'pos_helios');
    const a = createSampleApiFor(roomy, { latencyMs: 0 });
    const quantum = (await a.strategies()).strategies.find((s) => s.id === 'plan_quantum')!;
    expect([quantum.unlocked, quantum.requiredTier]).toEqual([
      false,
      { id: 'PLATINUM', label: 'Platinum' },
    ]);
    const locked = await failure(
      a.invest({ planId: quantum.id, amountCents: quantum.minimumCents }),
    );
    expect([locked.code, locked.status, locked.message]).toEqual([
      'tier_required',
      403,
      'Quantum Compute Ventures is reserved for Platinum tier and above — a benefit for our most loyal clients. Request a tier upgrade to unlock it.',
    ]);
  });

  it('obeys the company’s feature switches', async () => {
    const state = sampleData.createState();
    Object.assign(state.brand.features, {
      kyc: false,
      deposits: false,
      oracle: false,
      support: false,
    });
    const a = createSampleApiFor(state, { latencyMs: 0 });
    for (const call of [
      () => a.depositMethods(),
      () => a.manualDeposit({ methodId: 'method_btc', amountCents: 5_000 }),
      () => a.cardDeposit({ amountCents: 5_000 }),
      () => a.openTicket({ subject: 'Hello', message: 'A question.' }),
      () => a.submitKyc(kyc),
    ]) {
      const e = await failure(call());
      expect([e.code, e.status, e.message]).toEqual([
        'feature_disabled',
        403,
        'This feature is turned off for now.',
      ]);
    }
    const oracle = await failure(a.oracleAsk({ question: 'Hello?' }));
    expect([oracle.code, oracle.status, oracle.message]).toEqual([
      'feature_disabled',
      403,
      'The Oracle is turned off for now.',
    ]);
    await expect(
      a.replyTicket({ id: 'tk_statement', message: 'Still here.' }),
    ).resolves.toBeUndefined();
    expect((await a.kyc()).required).toBe(false);
    expect((await a.strategies()).kyc).toEqual({ required: false, approved: true });
  });

  it('limits the Oracle to 30 questions in ten minutes', async () => {
    let clock = Date.parse('2026-10-01T12:00:00.000Z');
    const a = createSampleApi({ latencyMs: 0, now: () => new Date(clock) });
    const first = await a.oracleAsk({ question: ORACLE_SUGGESTIONS[0] });
    expect(first.answer).toContain('Energy 42.0%');
    const next = await a.oracleAsk({ conversationId: first.conversationId, question: 'Hello?' });
    expect(next.conversationId).toBe(first.conversationId);
    expect(
      (await failure(a.oracleAsk({ conversationId: 'conv_nope', question: 'Hello?' }))).code,
    ).toBe('not_found');
    expect(await failure(a.oracleAsk({ question: ' ' }))).toMatchObject({
      code: 'invalid_input',
      status: 400,
      message: 'Ask a question of up to 2,000 characters.',
    });
    for (let i = 4; i < 30; i++) await a.oracleAsk({ question: ORACLE_SUGGESTIONS[2] });
    clock += 60_000;
    const limited = await failure(a.oracleAsk({ question: ORACLE_SUGGESTIONS[2] }));
    expect([limited.code, limited.status, limited.message, limited.retryAfterSeconds]).toEqual([
      'rate_limited',
      429,
      'You have asked a lot of questions. Please wait a minute.',
      540,
    ]);
    clock += 9 * 60_000;
    await expect(a.oracleAsk({ question: ORACLE_SUGGESTIONS[2] })).resolves.toMatchObject({
      model: 'sample',
    });
  });

  it('validates every body with the platform’s field messages', async () => {
    const a = api();
    const cases: Array<[() => Promise<unknown>, Record<string, string>]> = [
      [() => a.login({ email: 'nope', password: 'x' }), { email: 'Invalid email' }],
      [
        () => a.manualDeposit({ methodId: 'method_btc', amountCents: 12.5 }),
        { amountCents: 'Use whole cents.' },
      ],
      [() => a.cardDeposit({ amountCents: 0 }), { amountCents: 'Enter an amount above zero.' }],
      [
        () => a.sendTransfer({ recipient: '$grace', amountCents: 100, pin: '12' }),
        { pin: 'Enter your 4 to 8 digit PIN.' },
      ],
      [() => a.setPin({ currentPassword: 'sample', pin: '12a4' }), { pin: 'Use 4 to 8 digits.' }],
      [() => a.enableTwoFactor({ code: '12345' }), { code: 'Enter the 6-digit code.' }],
      [
        () =>
          a.addBeneficiary({ fullName: 'X', relationship: 'cousin' as never, sharePercent: 10 }),
        {
          relationship:
            "Invalid enum value. Expected 'spouse' | 'child' | 'parent' | 'sibling' | 'other', received 'cousin'",
        },
      ],
      [() => a.submitKyc({ ...kyc, dob: '2015-01-01' }), { dob: 'Must be at least 18 years old' }],
      [
        () =>
          a.submitKyc({
            ...kyc,
            country: 'US',
            state: 'California',
            postalCode: '9021',
            taxCountry: 'US',
          }),
        {
          state: 'Select a US state',
          postalCode: 'Enter a valid US ZIP code (12345 or 12345-6789)',
          taxId: 'Enter a valid SSN or ITIN (9 digits)',
        },
      ],
      [
        // The first message for a field wins: the length rule before the US ZIP rule.
        () => a.submitKyc({ ...kyc, country: 'US', state: 'CA', postalCode: '7' }),
        { postalCode: 'String must contain at least 2 character(s)' },
      ],
      [
        // A type error (docType) skips the country rules until it is fixed.
        () => a.submitKyc({ ...kyc, country: 'US', docType: 'VISA' as never }),
        {
          docType:
            "Invalid enum value. Expected 'PASSPORT' | 'DRIVERS_LICENSE' | 'NATIONAL_ID', received 'VISA'",
        },
      ],
      [
        () => a.previewLegacyPlan({ ...legacyPlanModel.defaultPlan, title: 'x' }),
        { 'plan.title': 'String must contain at least 3 character(s)' },
      ],
    ];
    for (const [call, fields] of cases) {
      const e = await failure(call());
      expect([e.code, e.status, e.message]).toEqual([
        'invalid_input',
        400,
        'Check the highlighted fields.',
      ]);
      expect(e.fields).toEqual(fields);
    }
    const range = await failure(
      a.previewLegacyPlan({
        ...legacyPlanModel.defaultPlan,
        horizonYears: 50,
        startingCapitalCents: 100_000_000_000,
        annualReturnBps: 3_000,
      }),
    );
    expect([range.code, range.status, range.message, range.fields]).toEqual([
      'invalid_input',
      400,
      'This scenario exceeds the supported range. Reduce the amount, rate or horizon.',
      {},
    ]);
    const weak = await failure(
      a.changePassword({ currentPassword: 'sample', newPassword: 'short' }),
    );
    expect([weak.code, weak.status, weak.detail]).toEqual([
      'weak_password',
      400,
      [
        'must be at least 12 characters',
        'must include an uppercase letter',
        'must include a digit',
        'must include a symbol',
      ],
    ]);
  });

  it('applies the money rules in the platform’s order', async () => {
    const a = api();
    await a.setPin({ currentPassword: 'sample', pin: '2468' });
    for (const [call, code, status, message] of [
      [
        () => a.sendTransfer({ recipient: '$nobody', amountCents: 100, pin: '2468' }),
        'recipient_not_found',
        404,
        'Recipient not found.',
      ],
      [
        () => a.sendTransfer({ recipient: '@AlexMorgan', amountCents: 100, pin: '2468' }),
        'self_transfer',
        400,
        'You cannot send funds to yourself.',
      ],
      [
        () =>
          a.sendTransfer({ recipient: 'grace@example.com', amountCents: 99_000_000, pin: '2468' }),
        'insufficient_funds',
        400,
        'Insufficient available funds.',
      ],
      [
        () => a.invest({ planId: 'plan_treasury', amountCents: 400_000 }),
        'below_minimum',
        400,
        'Amount below the minimum for this offering',
      ],
      [
        () => a.invest({ planId: 'plan_quantum', amountCents: 50_000_000 }),
        'insufficient_funds',
        400,
        'Insufficient available funds',
      ],
      [
        () => a.cardDeposit({ amountCents: 999 }),
        'below_minimum',
        400,
        'Minimum instant deposit is $10',
      ],
      [
        () => a.requestWithdrawal({ kind: 'position', investmentId: 'pos_helios' }),
        'not_matured',
        409,
        'Only matured positions can be withdrawn',
      ],
      [
        () => a.requestWithdrawal({ kind: 'cash', amountCents: 1_250_001 }),
        'insufficient_balance',
        409,
        'Amount exceeds your available manual balance ($12,500.00).',
      ],
    ] as const) {
      const e = await failure(call());
      expect([e.code, e.status, e.message]).toEqual([code, status, message]);
    }
    await a.requestWithdrawal({ kind: 'position', investmentId: 'pos_evergreen' });
    const detail = await a.investment('pos_evergreen');
    expect([detail.canRequestWithdrawal, detail.withdrawals[0]?.status]).toEqual([
      false,
      'PENDING',
    ]);
    expect(
      (await failure(a.requestWithdrawal({ kind: 'position', investmentId: 'pos_evergreen' })))
        .code,
    ).toBe('withdrawal_pending');
    const card = await a.cardDeposit({ amountCents: 2_500 });
    expect(card.kind).toBe('simulated');
    expect((await a.transfers()).wallets[0]!.availableCents).toBe(11_845_075 + 2_500);
  });

  it('reinvests a matured position from the wallet, once', async () => {
    const a = api();
    const [choice] = (await a.investments()).maturityChoices;
    expect(choice).toMatchObject({
      investmentId: 'pos_evergreen',
      planName: 'Evergreen Green Bond',
      amountCents: 10_000_000,
    });
    expect(await failure(a.maturityChoice({ choice: 'REINVEST' }))).toMatchObject({
      code: 'missing_plan',
      status: 400,
    });
    await a.maturityChoice({ choice: 'REINVEST', planId: 'plan_treasury' });
    const after = await a.investments();
    expect(after.maturityChoices).toEqual([]);
    expect(after.positions.find((p) => p.id === 'pos_evergreen')?.status).toBe('WITHDRAWN');
    expect(after.positions[0]).toMatchObject({
      status: 'ACTIVE',
      principalCents: 10_000_000,
      plan: { id: 'plan_treasury' },
    });
    expect((await a.dashboard()).cash.wallets[0]).toEqual({
      currency: 'USD',
      availableCents: 1_845_075,
      lockedCents: 100_000_000,
    });
    expect(
      await failure(a.maturityChoice({ choiceId: choice!.id, choice: 'WITHDRAW' })),
    ).toMatchObject({
      code: 'already_executed',
      status: 409,
    });
    expect(await failure(a.maturityChoice({ choice: 'WITHDRAW' }))).toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'No maturity choice is waiting.',
    });
  });

  it('versions a saved Legacy plan and refuses a stale save', async () => {
    const a = api();
    const first = await a.legacyPlan();
    expect([first.saved, first.revision, first.revisionId, first.history]).toEqual([
      false,
      0,
      null,
      [],
    ]);
    expect(first.plan).toEqual(legacyPlanModel.defaultPlan);
    expect(first.projection).toEqual(legacyPlanModel.project(legacyPlanModel.defaultPlan));
    const plan = { ...first.plan, title: 'Our next chapter' };
    expect(await a.saveLegacyPlan({ expectedRevision: 0, plan })).toEqual({
      revision: 1,
      revisionId: anyString,
      message: 'Private plan saved as version 1.',
    });
    const stale = await failure(a.saveLegacyPlan({ expectedRevision: 0, plan }));
    expect([stale.code, stale.status, stale.message]).toEqual([
      'conflict',
      409,
      'Your plan changed in another tab. Load the latest saved version before saving.',
    ]);
    const saved = await a.legacyPlan();
    expect([
      saved.saved,
      saved.revision,
      saved.plan.title,
      saved.history.map((h) => h.revision),
    ]).toEqual([true, 1, 'Our next chapter', [1]]);
    expect((await a.dashboard()).nextSteps.map((s) => s.id)).not.toContain('legacy_plan');
    const extreme = {
      ...plan,
      horizonYears: 50,
      startingCapitalCents: 100_000_000_000,
      annualReturnBps: 3_000,
    };
    const range = await failure(a.saveLegacyPlan({ expectedRevision: 1, plan: extreme }));
    expect([range.code, range.status, range.message]).toEqual([
      'invalid_input',
      400,
      'This scenario exceeds the supported range. Reduce the amount, rate or horizon.',
    ]);
    expect((await a.legacyPlan()).revision).toBe(1);
  });

  it('turns two-factor on with the demo code and then asks for it at sign-in', async () => {
    const a = api();
    const enrolment = await a.enrollTwoFactor({ currentPassword: 'sample' });
    expect(enrolment.uri).toMatch(/^otpauth:\/\/totp\/.+secret=.+&issuer=/);
    const wrong = await failure(a.enableTwoFactor({ code: '000000' }));
    expect([wrong.code, wrong.status]).toEqual(['invalid_code', 403]);
    const { backupCodes } = await a.enableTwoFactor({ code: '123456' });
    expect(backupCodes).toHaveLength(10);
    expect((await a.me()).security.twoFactorEnabled).toBe(true);
    const step = await a.login({ email: 'alex.morgan@example.com', password: 'x' });
    if (!step.requiresTwoFactor) throw new Error('expected the two-factor step');
    await expect(
      a.loginTwoFactor({ challenge: step.challenge, code: backupCodes[0]!, useBackup: true }),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
    const again = await a.login({ email: 'alex.morgan@example.com', password: 'x' });
    if (!again.requiresTwoFactor) throw new Error('expected the two-factor step');
    expect(
      (
        await failure(
          a.loginTwoFactor({ challenge: again.challenge, code: backupCodes[0]!, useBackup: true }),
        )
      ).code,
    ).toBe('invalid_code');
    expect((await failure(a.loginTwoFactor({ challenge: 'stale', code: '123456' }))).code).toBe(
      'invalid_challenge',
    );
    await a.disableTwoFactor({ currentPassword: 'sample' });
    expect(
      (await a.login({ email: 'alex.morgan@example.com', password: 'x' })).requiresTwoFactor,
    ).toBe(false);
  });

  it('signs this device out when its own session is revoked', async () => {
    const a = api();
    const me = await a.me();
    expect((await a.sessions()).find((s) => s.current)?.id).toBe(me.sessionId);
    expect(await a.revokeSession(me.sessionId)).toEqual({ ok: true, current: true });
    expect((await failure(a.me())).code).toBe('session_revoked');
    await expect(a.logout()).resolves.toBeUndefined();
    await a.login({ email: 'anyone@example.com', password: 'x' });
    const sessions = await a.sessions();
    expect(sessions.some((s) => s.id === me.sessionId)).toBe(false);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('keeps the push subscription in the sample world', async () => {
    const state = sampleData.createState();
    const a = createSampleApiFor(state, { latencyMs: 0 });
    const sub = {
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'p', auth: 'a' },
      platform: 'web' as const,
    };
    await a.pushSubscribe(sub);
    await a.pushSubscribe(sub);
    expect(state.pushSubscriptions).toEqual([sub]);
    await a.pushUnsubscribe(sub.endpoint);
    expect(state.pushSubscriptions).toEqual([]);
    expect((await failure(a.pushSubscribe({ ...sub, endpoint: 'not a url' }))).code).toBe(
      'invalid_input',
    );
  });

  it('answers each mutation with exactly what the platform’s handler answers', async () => {
    const a = api();
    const prefs: NotificationPrefs = {
      deposit: false,
      withdrawal: true,
      referral: true,
      support: true,
      kyc: true,
      security: true,
      system: false,
    };
    expect(await a.manualDeposit({ methodId: 'method_btc', amountCents: 5_000 })).toStrictEqual({
      id: anyString,
      amountCents: 5_000,
      methodLabel: 'Bitcoin',
      address: 'sample-bitcoin-address-preview-only',
      status: 'PENDING',
    });
    expect(await a.cardDeposit({ amountCents: 5_000 })).toStrictEqual({
      kind: 'simulated',
      url: 'https://example.com/app/return?status=success',
      orderId: anyString,
    });
    expect(await a.requestWithdrawal({ kind: 'cash', amountCents: 1_000 })).toStrictEqual({
      kind: 'cash',
      id: anyString,
      amountCents: 1_000,
      status: 'PENDING',
    });
    expect(
      await a.requestWithdrawal({ kind: 'position', investmentId: 'pos_evergreen' }),
    ).toStrictEqual({
      kind: 'position',
      id: anyString,
      amountCents: 10_750_000,
      status: 'PENDING',
    });
    expect(await a.setPin({ currentPassword: 'sample', pin: '2468' })).toBeUndefined();
    expect(
      await a.sendTransfer({ recipient: '$grace', amountCents: 1_000, pin: '2468' }),
    ).toStrictEqual({
      id: anyString,
      amountCents: 1_000,
      currency: 'USD',
      status: 'COMPLETED',
    });
    const [plan] = (await a.strategies()).strategies;
    expect(await a.invest({ planId: plan!.id, amountCents: plan!.minimumCents })).toStrictEqual({
      kind: 'wallet',
      orderId: anyString,
      url: null,
    });
    expect(await a.maturityChoice({ choice: 'WITHDRAW' })).toBeUndefined();
    expect(await a.openTicket({ subject: 'Hello', message: 'A question.' })).toStrictEqual({
      id: anyString,
    });
    expect(await a.replyTicket({ id: 'tk_statement', message: 'Thanks.' })).toBeUndefined();
    expect(await a.submitKyc(kyc)).toStrictEqual({
      submissionId: anyString,
      status: 'PENDING',
    });
    expect(
      await a.saveLegacyPlan({ expectedRevision: 0, plan: legacyPlanModel.defaultPlan }),
    ).toStrictEqual({
      revision: 1,
      revisionId: anyString,
      message: 'Private plan saved as version 1.',
    });
    const added = await a.addBeneficiary({
      fullName: 'Sam Morgan',
      relationship: 'child',
      sharePercent: 20,
      dateOfBirth: '2012-02-03',
    });
    expect(added).toStrictEqual({
      beneficiary: {
        id: anyString,
        fullName: 'Sam Morgan',
        relationship: 'child',
        dateOfBirth: '2012-02-03T00:00:00.000Z',
        sharePercent: 20,
        createdAt: anyString,
        updatedAt: anyString,
      },
    });
    const { id } = added.beneficiary;
    expect(
      await a.updateBeneficiary({
        id,
        fullName: 'Sam Morgan',
        relationship: 'child',
        sharePercent: 30,
      }),
    ).toStrictEqual({
      beneficiary: {
        ...added.beneficiary,
        sharePercent: 30,
        dateOfBirth: null,
        updatedAt: anyString,
      },
    });
    expect(await a.removeBeneficiary(id)).toBeUndefined();
    expect(await a.markRead('al_tier')).toStrictEqual({ updated: false, unreadCount: 3 });
    expect(await a.markRead('al_matured')).toStrictEqual({ updated: true, unreadCount: 2 });
    expect(await a.setNotificationPrefs(prefs)).toStrictEqual({ notificationPrefs: prefs });
    expect((await a.me()).notificationPrefs).toEqual(prefs);
    expect(await a.revokeSession('sess_mac')).toStrictEqual({ ok: true, current: false });
    expect(await a.enrollTwoFactor({ currentPassword: 'sample' })).toStrictEqual({
      secret: anyString,
      uri: anyString,
      account: 'alex.morgan@example.com',
    });
    expect(await a.enableTwoFactor({ code: '123456' })).toStrictEqual({
      backupCodes: anyArray,
    });
    expect(await a.disableTwoFactor({ currentPassword: 'sample' })).toBeUndefined();
    expect(
      await a.changePassword({ currentPassword: 'sample', newPassword: 'N3w-password!!' }),
    ).toBeUndefined();
    expect((await failure(a.setPin({ currentPassword: 'sample', pin: '1357' }))).code).toBe(
      'current_incorrect',
    );
    expect(await a.setPin({ currentPassword: 'N3w-password!!', pin: '1357' })).toBeUndefined();
  });
});
