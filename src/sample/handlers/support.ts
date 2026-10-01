// Support tickets (support/tickets, support/ticket, support/reply) with the platform's rules: new
// tickets obey the `support` switch, reading and replying do not, and a reply reopens a ticket.
// The request fields keep PlatformApi's names (`message`, `id`), which the platform calls `body`
// and `ticketId`; a field error is keyed by PlatformApi's name here.
import { z } from 'zod';
import type { OpenTicketResult, TicketList, TicketSummary, TicketThread } from '../../api/types';
import type { SampleTicket } from '../sampleData';
import type { SampleContext } from './context';
import { fail, parse, requireFeature, requireQuery } from './context';
import { iso } from './views';

const PAGE_SIZE = 20;

const OpenBody = z.object({
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
});
const ReplyBody = z.object({
  id: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(4000),
});

function summary(t: SampleTicket): TicketSummary {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
}

/** Newest activity first, 20 to a page; a page below 1 or not a number is page 1. */
export function supportTickets(ctx: SampleContext, page?: number): TicketList {
  const p = page !== undefined && Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const tickets = [...ctx.state.tickets].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  return {
    page: p,
    pageSize: PAGE_SIZE,
    total: tickets.length,
    tickets: tickets.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map(summary),
  };
}

export function openTicket(ctx: SampleContext, body: unknown): OpenTicketResult {
  requireFeature(ctx, 'support');
  const { subject, message } = parse(OpenBody, body);
  const now = ctx.now();
  const id = ctx.newId('tk');
  ctx.state.tickets.unshift({
    id,
    subject,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    messages: [{ id: ctx.newId('msg'), from: 'you', body: message, createdAt: now }],
  });
  return { id };
}

export function ticket(ctx: SampleContext, rawId: string): TicketThread {
  const id = requireQuery('id', rawId);
  const thread = ctx.state.tickets.find((t) => t.id === id);
  if (!thread) fail('not_found', 404, 'Ticket not found.');
  return {
    ...summary(thread),
    messages: thread.messages.map((m) => ({
      id: m.id,
      from: m.from,
      body: m.body,
      createdAt: iso(m.createdAt),
    })),
  };
}

export function replyTicket(ctx: SampleContext, body: unknown): void {
  const { id, message } = parse(ReplyBody, body);
  const thread = ctx.state.tickets.find((t) => t.id === id);
  if (!thread) fail('ticket_not_found', 404, 'Ticket not found.');
  const now = ctx.now();
  thread.messages.push({ id: ctx.newId('msg'), from: 'you', body: message, createdAt: now });
  thread.status = 'OPEN';
  thread.updatedAt = now;
}
