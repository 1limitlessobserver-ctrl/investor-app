// Identity verification (GET and POST /kyc). The platform validates a submission with the
// website's SUBMIT_SCHEMA (src/lib/kyc/kyc.ts, not staged); this is that schema as the platform's
// error inventory (Plan B's mobileErrors.draft.md) records it, field by field and message by
// message. The `kyc` switch gates submitting only; one submission is reviewed at a time.
import { z } from 'zod';
import type { KycOverview, KycSubmitResult } from '../../api/types';
import type { SampleContext } from './context';
import { fail, parse, requireFeature } from './context';
import { iso, isoOrNull } from './views';

/** Two downscaled camera images of about 1.6 MB of base64 each, plus the form. */
const KYC_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_MAX_CHARS = 1_600_000;

const country = (message: string) => z.string().regex(/^[A-Z]{2}$/, message);
const image = z
  .string()
  .refine(
    (v) => /^data:image\/(png|jpeg|jpg|webp);base64,/.test(v),
    'Must be a PNG, JPEG, or WebP image',
  )
  .refine(
    (v) => v.length <= IMAGE_MAX_CHARS,
    'Image is too large — retake or choose a smaller file',
  )
  .optional();

/** True when the person born on `dob` ("YYYY-MM-DD") is at least 18 at `now`. */
function isAdult(dob: string, now: Date): boolean {
  const [year, month, day] = dob.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return true;
  return Date.UTC(year + 18, month - 1, day) <= now.getTime();
}

function submissionSchema(now: Date) {
  return z
    .object({
      legalName: z.string().trim().min(2).max(120),
      dob: z
        .string()
        .date()
        .refine((v) => isAdult(v, now), 'Must be at least 18 years old'),
      country: country('Select your country of residence'),
      nationality: country('Select your nationality'),
      email: z.string().email().max(200).optional(),
      phone: z.string().max(40).optional(),
      taxCountry: country('Select your tax residency'),
      taxId: z.string().trim().min(3).max(40),
      docType: z.enum(['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID']),
      docReference: z.string().trim().min(3).max(120),
      documentImage: image,
      selfieImage: image,
      street1: z.string().trim().min(3).max(120),
      street2: z.string().max(120).optional(),
      city: z.string().trim().min(2).max(85),
      state: z.string().trim().min(1).max(85),
      postalCode: z.string().trim().min(2).max(12),
      addressLines: z.string().max(600).optional(),
      employmentStatus: z.string().trim().min(1).max(60),
      occupation: z.string().max(120).optional(),
      sourceOfFunds: z.string().trim().min(1).max(80),
      annualIncome: z.string().trim().min(1).max(60),
      investmentExperience: z.string().trim().min(1).max(60),
    })
    .superRefine((s, issues) => {
      // The country rules; zod skips them while any field has a type error, as on the platform.
      if (s.country === 'US') {
        if (!/^[A-Z]{2}$/.test(s.state)) {
          issues.addIssue({ code: 'custom', path: ['state'], message: 'Select a US state' });
        }
        if (!/^\d{5}(-\d{4})?$/.test(s.postalCode)) {
          issues.addIssue({
            code: 'custom',
            path: ['postalCode'],
            message: 'Enter a valid US ZIP code (12345 or 12345-6789)',
          });
        }
      }
      if (s.taxCountry === 'US' && !/^(\d{3}-\d{2}-\d{4}|\d{9})$/.test(s.taxId)) {
        issues.addIssue({
          code: 'custom',
          path: ['taxId'],
          message: 'Enter a valid SSN or ITIN (9 digits)',
        });
      }
    });
}

export function kyc(ctx: SampleContext): KycOverview {
  const { state } = ctx;
  const { latest } = state.kyc;
  return {
    required: state.brand.features.kyc,
    status: state.kyc.status,
    submittedAt: isoOrNull(state.kyc.submittedAt),
    approvedAt: isoOrNull(state.kyc.approvedAt),
    canSubmit: state.kyc.status !== 'PENDING',
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          notes: latest.notes,
          createdAt: iso(latest.createdAt),
          reviewedAt: isoOrNull(latest.reviewedAt),
        }
      : null,
  };
}

export function submitKyc(ctx: SampleContext, submission: unknown): KycSubmitResult {
  requireFeature(ctx, 'kyc');
  if (new TextEncoder().encode(JSON.stringify(submission)).length > KYC_MAX_BYTES) {
    fail('payload_too_large', 413, 'The request is too large.');
  }
  const input = parse(submissionSchema(ctx.now()), submission);
  const { state } = ctx;
  if (state.kyc.status === 'PENDING') {
    fail('kyc_pending', 409, 'A KYC submission is already under review');
  }
  const now = ctx.now();
  const submissionId = ctx.newId('kyc');
  state.kyc = {
    ...state.kyc,
    status: 'PENDING',
    submittedAt: now,
    latest: {
      id: submissionId,
      status: 'PENDING',
      notes: null,
      createdAt: now,
      reviewedAt: null,
      docType: input.docType,
    },
  };
  return { submissionId, status: 'PENDING' };
}
