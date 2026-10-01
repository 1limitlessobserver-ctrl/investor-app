// The Legacy plan (legacy-plan, legacy-plan/preview) and beneficiaries (beneficiaries/*) with the
// platform's rules: the plan's strict schema and projection are the platform's own
// (legacyPlanModel); a save names the revision it read and a stale one is 409 `conflict`; a scenario
// past the safe range is `invalid_input` without fields; beneficiaries' shares total at most 100.
import { z } from 'zod';
import { MobileApiError } from '../../api/MobileApiError';
import type {
  Beneficiaries,
  Beneficiary,
  BeneficiaryResult,
  LegacyPlan,
  LegacyPlanState,
  LegacyProjection,
  SaveLegacyPlanResult,
} from '../../api/types';
import {
  DEFAULT_LEGACY_PLAN,
  LEGACY_RANGE_ERROR,
  LegacyPlanSchema,
  projectLegacyPlan,
} from '../../lib/legacyPlanModel';
import type { SampleBeneficiary } from '../sampleData';
import type { SampleContext } from './context';
import { fail, parse } from './context';
import { iso, isoOrNull } from './views';

const HISTORY_LISTED = 12;

const SaveBody = z
  .object({ expectedRevision: z.number().int().min(0), plan: LegacyPlanSchema })
  .strict();
const PreviewBody = z.object({ plan: LegacyPlanSchema });
const BeneficiaryFields = z.object({
  fullName: z.string().trim().min(1).max(120),
  relationship: z.enum(['spouse', 'child', 'parent', 'sibling', 'other']),
  sharePercent: z.number().int().min(1).max(100),
  dateOfBirth: z.string().date().nullable().optional(),
});
const UpdateBody = BeneficiaryFields.extend({ id: z.string().min(1).max(64) });
const IdBody = z.object({ id: z.string().min(1).max(64) });

/** The platform's projection, with its range error answered as the routes answer it. */
function project(plan: LegacyPlan): LegacyProjection {
  try {
    return projectLegacyPlan(plan);
  } catch (err) {
    throw new MobileApiError(
      'invalid_input',
      400,
      err instanceof Error ? err.message : LEGACY_RANGE_ERROR,
    );
  }
}

export function legacyPlan(ctx: SampleContext): LegacyPlanState {
  const { legacy } = ctx.state;
  const plan = legacy.plan ?? DEFAULT_LEGACY_PLAN;
  return {
    saved: legacy.plan !== null,
    revision: legacy.revision,
    revisionId: legacy.revisionId,
    updatedAt: isoOrNull(legacy.updatedAt),
    history: legacy.history.slice(0, HISTORY_LISTED).map((h) => ({
      id: h.id,
      revision: h.revision,
      createdAt: iso(h.createdAt),
    })),
    plan,
    projection: projectLegacyPlan(plan),
  };
}

export function saveLegacyPlan(ctx: SampleContext, body: unknown): SaveLegacyPlanResult {
  const { expectedRevision, plan } = parse(SaveBody, body);
  project(plan);
  const { state } = ctx;
  if (expectedRevision !== state.legacy.revision) {
    fail(
      'conflict',
      409,
      'Your plan changed in another tab. Load the latest saved version before saving.',
    );
  }
  const revision = state.legacy.revision + 1;
  const revisionId = ctx.newId('rev');
  const now = ctx.now();
  state.legacy = {
    revision,
    revisionId,
    updatedAt: now,
    history: [{ id: revisionId, revision, createdAt: now }, ...state.legacy.history],
    plan,
  };
  return { revision, revisionId, message: `Private plan saved as version ${revision}.` };
}

export function previewLegacyPlan(plan: unknown): { projection: LegacyProjection } {
  return { projection: project(parse(PreviewBody, { plan }).plan) };
}

function beneficiaryView(b: SampleBeneficiary): Beneficiary {
  return {
    id: b.id,
    fullName: b.fullName,
    relationship: b.relationship,
    // The platform stores a birth date as midnight UTC.
    dateOfBirth: b.dateOfBirth === null ? null : `${b.dateOfBirth}T00:00:00.000Z`,
    sharePercent: b.sharePercent,
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  };
}

const totalShare = (rows: SampleBeneficiary[]) => rows.reduce((sum, b) => sum + b.sharePercent, 0);

function refuseOver100(others: number, share: number): void {
  if (others + share > 100) {
    fail('share_exceeds_100', 409, 'Total beneficiary share would exceed 100%.', {
      detail: [String(others), String(share)],
    });
  }
}

export function beneficiaries(ctx: SampleContext): Beneficiaries {
  const rows = [...ctx.state.beneficiaries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const total = totalShare(rows);
  return {
    beneficiaries: rows.map(beneficiaryView),
    summary: { count: rows.length, totalShare: total, remainder: Math.max(0, 100 - total) },
  };
}

export function addBeneficiary(ctx: SampleContext, body: unknown): BeneficiaryResult {
  const input = parse(BeneficiaryFields, body);
  const { state } = ctx;
  refuseOver100(totalShare(state.beneficiaries), input.sharePercent);
  const now = ctx.now();
  const row: SampleBeneficiary = {
    id: ctx.newId('ben'),
    fullName: input.fullName,
    relationship: input.relationship,
    dateOfBirth: input.dateOfBirth ?? null,
    sharePercent: input.sharePercent,
    createdAt: now,
    updatedAt: now,
  };
  state.beneficiaries.push(row);
  return { beneficiary: beneficiaryView(row) };
}

/** The whole record is sent; a birth date left out is cleared, as when adding one. */
export function updateBeneficiary(ctx: SampleContext, body: unknown): BeneficiaryResult {
  const { id, ...input } = parse(UpdateBody, body);
  const { state } = ctx;
  const row = state.beneficiaries.find((b) => b.id === id);
  if (!row) fail('beneficiary_not_found', 404, 'Beneficiary not found.');
  refuseOver100(totalShare(state.beneficiaries.filter((b) => b.id !== id)), input.sharePercent);
  row.fullName = input.fullName;
  row.relationship = input.relationship;
  row.sharePercent = input.sharePercent;
  row.dateOfBirth = input.dateOfBirth ?? null;
  row.updatedAt = ctx.now();
  return { beneficiary: beneficiaryView(row) };
}

export function removeBeneficiary(ctx: SampleContext, id: string): void {
  const body = parse(IdBody, { id });
  const { state } = ctx;
  if (!state.beneficiaries.some((b) => b.id === body.id)) {
    fail('beneficiary_not_found', 404, 'Beneficiary not found.');
  }
  state.beneficiaries = state.beneficiaries.filter((b) => b.id !== body.id);
}
