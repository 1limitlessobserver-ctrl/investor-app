// What every sample handler works with (the world, the clock and the sample session) and the
// platform's rules for refusing a request (src/lib/mobile/{errors,route,fields}.ts): a body that
// fails its schema is `invalid_input` with `fields` keyed as the platform keys them (the zod path
// joined by ".", "_" for the body itself, the first message per key), and every other refusal is a
// MobileApiError with the platform's code, status and text.
import { z } from 'zod';
import { MobileApiError, type MobileApiErrorExtra } from '../../api/MobileApiError';
import type { Brand } from '../../api/types';
import type { SampleState } from '../sampleData';

export interface SampleContext {
  readonly state: SampleState;
  /** The sample API's latency, which the Oracle reports as its model's time. */
  readonly latencyMs: number;
  now(): Date;
  /** An id for a record the sample creates: `<prefix>_sample_<n>`. */
  newId(prefix: string): string;
  /**
   * This device's session. Revoking it (or closing the account, or `_test_revoke`) ends it: every
   * signed-in route then answers 401 `session_revoked` until the next sign-in starts another.
   */
  readonly session: { ended: boolean };
  /** The two-factor challenges handed out at sign-in and not used yet. */
  readonly challenges: Set<string>;
}

export function createContext(
  state: SampleState,
  now: () => Date,
  latencyMs: number,
): SampleContext {
  let issued = 0;
  return {
    state,
    latencyMs,
    now,
    newId: (prefix) => `${prefix}_sample_${++issued}`,
    session: { ended: false },
    challenges: new Set(),
  };
}

export function fail(
  code: string,
  status: number,
  message: string,
  extra?: MobileApiErrorExtra,
): never {
  throw new MobileApiError(code, status, message, extra);
}

function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/** The body as the schema reads it, or 400 `invalid_input` naming each field it refused. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  return fail('invalid_input', 400, 'Check the highlighted fields.', {
    fields: zodFields(parsed.error),
  });
}

/** A required query value (`id`, `period`): trimmed, present, at most `max` characters. */
export function requireQuery(name: string, value: unknown, max = 128): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) {
    fail('invalid_input', 400, `Missing or invalid ${name}.`, { fields: { [name]: 'Required' } });
  }
  return text;
}

/** The company's switch for a feature; the Oracle words its own refusal. */
export function requireFeature(ctx: SampleContext, feature: keyof Brand['features']): void {
  if (!ctx.state.brand.features[feature]) {
    fail('feature_disabled', 403, 'This feature is turned off for now.');
  }
}

/** The password-gated actions; a wrong password is 403 here, never 401 (that means a token). */
export function requirePassword(ctx: SampleContext, currentPassword: string): void {
  if (currentPassword !== ctx.state.user.password) {
    fail('current_incorrect', 403, 'Current password is incorrect.');
  }
}

/** A money amount in integer cents: positive, at most one billion dollars. */
export const AmountCents = z
  .number()
  .int('Use whole cents.')
  .positive('Enter an amount above zero.')
  .max(100_000_000_000, 'That amount is too large.');
