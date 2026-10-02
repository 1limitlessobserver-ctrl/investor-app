// Web Push and local notifications through the app's service worker. The push subscription is
// made for the platform's VAPID key (one the browser holds for another key is ended and made anew)
// and handed to the platform as PushSubscriptionInput; a local notification shows the app's own
// icon and badge. Without the Notification API, a service worker registration or a PushManager,
// there is no push: permission() says 'unsupported'.

import type { PushSubscriptionInput } from '../../api/types';
import { base64url } from '../../lib/base64url';
import type { NotificationsAdapter } from '../types';

const UNSUPPORTED = 'Notifications are not supported in this browser.';
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

/** The parts of the Notification API used here; absent where the browser has none. */
type NotificationApi = Pick<typeof Notification, 'permission' | 'requestPermission'>;

/**
 * `registration` resolves the app's service worker registration, or rejects when there is none:
 * then unsubscribe() answers null, and subscribe() and show() reject with its error.
 */
export function createWebNotifications(
  opts: { registration?: (() => Promise<ServiceWorkerRegistration>) | undefined } = {},
): NotificationsAdapter {
  const { registration } = opts;
  /** The subscription subscribe() last handed over, for unsubscribe() to end. */
  let made: PushSubscription | null = null;

  /** The Notification API, where the browser has Web Push at all. */
  function notificationApi(): NotificationApi | undefined {
    const api = (globalThis as { Notification?: NotificationApi }).Notification;
    return registration && 'PushManager' in globalThis ? api : undefined;
  }

  function serviceWorker(): Promise<ServiceWorkerRegistration> {
    if (!registration) throw new Error(UNSUPPORTED);
    return registration();
  }

  return {
    permission() {
      return notificationApi()?.permission ?? 'unsupported';
    },

    async request() {
      const api = notificationApi();
      if (!api) return 'unsupported';
      return (await api.requestPermission()) === 'granted' ? 'granted' : 'denied';
    },

    async subscribe(vapidPublicKey) {
      const applicationServerKey = pushKey(vapidPublicKey);
      const { pushManager } = await serviceWorker();
      if (!pushManager) throw new Error(UNSUPPORTED); // a worker without push (Safari before 16)
      const held = await pushManager.getSubscription();
      if (held && madeFor(held, applicationServerKey)) {
        made = held;
        return subscriptionInput(held);
      }
      // The browser keeps one subscription at a time: end one made for another key (the platform
      // rotated it) first. The platform prunes the old endpoint once pushes to it fail.
      if (held) await held.unsubscribe();
      const subscription = await pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      made = subscription;
      return subscriptionInput(subscription);
    },

    async unsubscribe() {
      if (!registration) return null;
      // Without a service worker there is no subscription to end.
      const worker = await registration().catch(() => null);
      if (!worker?.pushManager) return null;
      // The browser's own answer covers a subscription made before this page loaded.
      const subscription = (await worker.pushManager.getSubscription()) ?? made;
      if (!subscription) return null;
      await subscription.unsubscribe();
      made = null;
      return subscription.endpoint;
    },

    async show({ title, body, tag }) {
      const options: NotificationOptions = { icon: ICON, badge: BADGE };
      if (body !== undefined) options.body = body;
      if (tag !== undefined) options.tag = tag;
      await (await serviceWorker()).showNotification(title, options);
    },
  };
}

/** The VAPID key's bytes: an uncompressed P-256 point, 65 bytes from 0x04. */
function pushKey(vapidPublicKey: string): Uint8Array<ArrayBuffer> {
  try {
    const bytes = base64url.decode(vapidPublicKey);
    if (bytes.length === 65 && bytes[0] === 0x04) return bytes;
  } catch {
    // Not base64url: refused below.
  }
  throw new Error('The push key (vapidPublicKey) is not a valid P-256 public key.');
}

/** Whether the subscription was made for this key; false when the browser does not say. */
function madeFor(subscription: PushSubscription, key: Uint8Array): boolean {
  const held = subscription.options?.applicationServerKey;
  if (!held) return false;
  const bytes = new Uint8Array(held);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const { endpoint, keys } = subscription.toJSON();
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('The push subscription came without its endpoint or keys.');
  }
  return { endpoint, keys: { p256dh, auth }, platform: 'web' };
}
