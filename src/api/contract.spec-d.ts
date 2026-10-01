// What each PlatformApi mutation resolves, pinned to the platform route handler's own answer
// (.reference/platform/src/app/api/mobile/v1/**/route.ts): every expected type below is that
// handler's return statement written out, so a DTO in types.ts or a method in PlatformApi.ts that
// drifts from the wire fails `npm run typecheck` (tsc checks this file; Vitest never runs it).
// Where a handler answers `{ ok: true }`, PlatformApi resolves void.
import { expectTypeOf } from 'vitest';
import type { z } from 'zod';
import type { LegacyPlanSchema } from '../lib/legacyPlanModel';
import type { ROUTES } from './createLiveApi';
import type { PlatformApi } from './PlatformApi';
import type {
  BeneficiaryInput,
  BeneficiaryRelationship,
  LegacyPlan,
  NotificationPrefs,
  TransferStatus,
} from './types';

type Resolved<K extends keyof PlatformApi> = PlatformApi[K] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;

/** listBeneficiaries / addBeneficiary / updateBeneficiary rows, as the beneficiaries routes send them. */
type BeneficiaryRow = {
  id: string;
  fullName: string;
  relationship: BeneficiaryRelationship;
  dateOfBirth: string | null;
  sharePercent: number;
  createdAt: string;
  updatedAt: string;
};

// deposit/manual: { id, amountCents, methodLabel, address, status: 'PENDING' }
expectTypeOf<Resolved<'manualDeposit'>>().toEqualTypeOf<{
  id: string;
  amountCents: number;
  methodLabel: string;
  address: string;
  status: 'PENDING';
}>();
// transfers (POST): { id, amountCents, currency, status }
expectTypeOf<Resolved<'sendTransfer'>>().toEqualTypeOf<{
  id: string;
  amountCents: number;
  currency: string;
  status: TransferStatus;
}>();
// invest: { kind, orderId, url: kind === 'wallet' ? null : url }
expectTypeOf<Resolved<'invest'>>().toEqualTypeOf<{
  kind: 'stripe' | 'simulated' | 'wallet';
  orderId: string;
  url: string | null;
}>();
// support/tickets (POST): createTicket's { id }
expectTypeOf<Resolved<'openTicket'>>().toEqualTypeOf<{ id: string }>();
// support/reply: { ok: true }
expectTypeOf<Resolved<'replyTicket'>>().toEqualTypeOf<void>();
// maturity-choice: { ok: true }
expectTypeOf<Resolved<'maturityChoice'>>().toEqualTypeOf<void>();
// kyc (POST): { submissionId, status: 'PENDING' }
expectTypeOf<Resolved<'submitKyc'>>().toEqualTypeOf<{ submissionId: string; status: 'PENDING' }>();
// legacy-plan (POST): the service's { revision, revisionId, message }
expectTypeOf<Resolved<'saveLegacyPlan'>>().toEqualTypeOf<{
  revision: number;
  revisionId: string;
  message: string;
}>();
// beneficiaries (POST) and beneficiaries/update: { beneficiary }
expectTypeOf<Resolved<'addBeneficiary'>>().toEqualTypeOf<{ beneficiary: BeneficiaryRow }>();
expectTypeOf<Resolved<'updateBeneficiary'>>().toEqualTypeOf<{ beneficiary: BeneficiaryRow }>();
// beneficiaries/remove: { ok: true }
expectTypeOf<Resolved<'removeBeneficiary'>>().toEqualTypeOf<void>();
// notifications/read: { updated, unreadCount }
expectTypeOf<Resolved<'markRead'>>().toEqualTypeOf<{ updated: boolean; unreadCount: number }>();
// me/notification-prefs: { notificationPrefs: prefs }
expectTypeOf<Resolved<'setNotificationPrefs'>>().toEqualTypeOf<{
  notificationPrefs: NotificationPrefs;
}>();

// beneficiaries/update validates BeneficiaryFields.extend({ id }): the whole record, not a patch.
expectTypeOf<Parameters<PlatformApi['updateBeneficiary']>[0]>().toEqualTypeOf<
  { id: string } & BeneficiaryInput
>();

// The Legacy plan DTO is exactly what the platform's strict schema (ported as is) accepts.
expectTypeOf<z.infer<typeof LegacyPlanSchema>>().toEqualTypeOf<LegacyPlan>();

// No path in the live client's route table carries a query string: a method adds its own keys.
// The paths are literal types (an unknown path is none of them), so the second check sees each.
type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]['path'];
expectTypeOf<'/not-a-route'>().not.toExtend<RoutePath>();
expectTypeOf<Extract<RoutePath, `${string}?${string}`>>().toBeNever();
