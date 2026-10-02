// Web push for the session (the session controller drives it). Once a session opens signed in,
// this browser's push subscription is made for the company's VAPID key and handed to the platform
// (POST /push/subscribe): only when the brand names a key, the investor has already allowed
// notifications, and the app's service worker is active. Permission is asked for only where the
// investor turns alerts on (Profile), never here. At the investor's own sign-out the platform is
// told the subscription ends (POST /push/unsubscribe) while the session can still say so; the
// controller then ends the browser's subscription itself. Nothing here reaches the investor: a
// step that fails is reported to the console, and push stays off.

import type { PlatformApi } from '../api/PlatformApi';
import type { Brand } from '../api/types';
import { reportProblem } from '../lib/report';
import type { NotificationsAdapter } from '../platform/types';

export interface PushDeps {
  api: Pick<PlatformApi, 'pushSubscribe' | 'pushUnsubscribe'>;
  notifications: NotificationsAdapter;
  /** The company's brand: the one the app has, else fetched. */
  brand: () => Promise<Brand>;
  /** Whether the app's service worker is active, waited for a short while at most. */
  workerReady: () => Promise<boolean>;
}

export function createPushRegistration(deps: PushDeps) {
  const { api, notifications } = deps;
  // The endpoint the platform was handed for the session open now: what the sign-out takes back.
  let endpoint: string | null = null;

  return {
    /**
     * Hands this browser's subscription to the platform, where push can be on. `current` answers
     * whether the session it was started for is still the one open: once it is not, nothing more
     * is done, and nothing is recorded.
     */
    async register(current: () => boolean): Promise<void> {
      try {
        if (notifications.permission() !== 'granted') return;
        const key: unknown = (await deps.brand()).vapidPublicKey;
        if (typeof key !== 'string' || !current()) return;
        // A first visit's worker may still be installing; with none active, there is no push.
        if (!(await deps.workerReady()) || !current()) return;
        const subscription = await notifications.subscribe(key);
        if (!current()) return;
        await api.pushSubscribe(subscription);
        if (current()) endpoint = subscription.endpoint;
      } catch (error) {
        reportProblem('turning on push', error);
      }
    },

    /**
     * Tells the platform this browser's subscription ends, when one was handed over for the
     * session open now; rejects as that call does. The endpoint is forgotten either way.
     */
    unregister(): Promise<void> {
      const known = endpoint;
      endpoint = null;
      return known === null ? Promise.resolve() : api.pushUnsubscribe(known);
    },

    /** The session ended: what it handed over is no longer this tab's to take back. */
    forget(): void {
      endpoint = null;
    },
  };
}
