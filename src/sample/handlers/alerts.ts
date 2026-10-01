// Alerts (notifications, notifications/read) as the platform answers them, and the app's own
// web-push registration, which the platform does not have yet: the sample keeps the subscription in
// its world, one per endpoint, so the subscribe flow can be shown.
import { z } from 'zod';
import type { MarkReadResult, NotificationList } from '../../api/types';
import type { SampleContext } from './context';
import { parse } from './context';
import { alertView, newestAlerts, unreadCount } from './views';

const ReadBody = z.object({ id: z.string().min(1).max(64).optional() });
const Subscription = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .regex(/^https:\/\//, 'Use an https endpoint.'),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
  platform: z.literal('web'),
});
const Endpoint = z.object({ endpoint: z.string().min(1).max(2048) });

/** `limit` is 1 to 100, 50 when left out or not a number, as the route reads `?limit=`. */
export function notifications(ctx: SampleContext, limit?: number): NotificationList {
  const n =
    limit === undefined || !Number.isFinite(limit)
      ? 50
      : Math.min(Math.max(Math.trunc(limit), 1), 100);
  return {
    unreadCount: unreadCount(ctx.state),
    notifications: newestAlerts(ctx.state, n).map(alertView),
  };
}

/** One alert, or all of them; an id that is not an unread alert of the investor changes nothing. */
export function markRead(ctx: SampleContext, id?: string): MarkReadResult {
  const body = parse(ReadBody, id === undefined ? {} : { id });
  const { state } = ctx;
  const now = ctx.now();
  let updated = true;
  if (body.id !== undefined) {
    const alert = state.alerts.find((a) => a.id === body.id && a.readAt === null);
    if (alert) alert.readAt = now;
    updated = alert !== undefined;
  } else {
    for (const alert of state.alerts) alert.readAt ??= now;
  }
  return { updated, unreadCount: unreadCount(state) };
}

export function pushSubscribe(ctx: SampleContext, subscription: unknown): void {
  const sub = parse(Subscription, subscription);
  const { state } = ctx;
  state.pushSubscriptions = [
    ...state.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint),
    sub,
  ];
}

export function pushUnsubscribe(ctx: SampleContext, endpoint: string): void {
  const body = parse(Endpoint, { endpoint });
  const { state } = ctx;
  state.pushSubscriptions = state.pushSubscriptions.filter((s) => s.endpoint !== body.endpoint);
}
