// The Oracle (oracle/ask) in the sample: the platform's switch, its limit of 30 questions (here in
// any ten minutes) and its checks, in its order; the answer comes from sampleOracle, built from the
// same dashboard and investments the screens show.
import { z } from 'zod';
import type { OracleAnswer } from '../../api/types';
import { sampleOracleAnswer } from '../sampleOracle';
import type { SampleContext } from './context';
import { fail } from './context';
import { dashboard, investments } from './portfolio';

const QUESTIONS_PER_WINDOW = 30;
const WINDOW_MS = 10 * 60_000;

const AskBody = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  question: z.string().trim().min(1).max(2000),
});

export function oracleAsk(ctx: SampleContext, body: unknown): OracleAnswer {
  const { state } = ctx;
  if (!state.brand.features.oracle) {
    fail('feature_disabled', 403, 'The Oracle is turned off for now.');
  }
  const now = ctx.now().getTime();
  const asked = state.oracle.askedAt.filter((t) => t > now - WINDOW_MS);
  state.oracle.askedAt = asked;
  const oldest = asked[0];
  if (asked.length >= QUESTIONS_PER_WINDOW && oldest !== undefined) {
    fail('rate_limited', 429, 'You have asked a lot of questions. Please wait a minute.', {
      retryAfterSeconds: Math.ceil((oldest + WINDOW_MS - now) / 1000),
    });
  }
  // Counted before the question is read: an invalid question still counts, as on the platform.
  asked.push(now);
  const parsed = AskBody.safeParse(body);
  if (!parsed.success) fail('invalid_input', 400, 'Ask a question of up to 2,000 characters.');
  const { conversationId, question } = parsed.data;
  if (conversationId !== undefined && !state.oracle.conversations.includes(conversationId)) {
    fail('not_found', 404, 'Conversation not found.');
  }
  let conversation = conversationId;
  if (conversation === undefined) {
    conversation = ctx.newId('conv');
    state.oracle.conversations.push(conversation);
  }
  const context = {
    brandName: state.brand.name,
    dashboard: dashboard(ctx),
    investments: investments(ctx),
    now: ctx.now(),
  };
  return sampleOracleAnswer(question, context, conversation, ctx.latencyMs);
}
