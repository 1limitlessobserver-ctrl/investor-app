// Web Push and local notifications through the app's service worker. The push subscription is
// made for the platform's VAPID key and handed to the platform as PushSubscriptionInput; a local
// notification shows the app's own icon and badge. Without the Notification API or a service
// worker registration, there is no push: permission() says 'unsupported'.

import type { PushSubscriptionInput } from '../../api/types';
import { base64url } from '../../lib/base64url';
import type { NotificationsAdapter } from '../types';

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

/** The parts of the Notification API used here; absent where the browser has none. */
type NotificationApi = Pick<typeof Notification, 'permission' | 'requestPermission'>;

/** `registration` resolves the app's service worker registration: navigator.serviceWorker.ready. */
export function createWebNotifications(
  opts: { registration?: (() => Promise<ServiceWorkerRegistration>) | undefined } = {},
): NotificationsAdapter {
  const { registration } = opts;
  /** The subscription subscribe() last handed over, for unsubscribe() to end. */
  let made: PushSubscription | null = null;

  /** The Notification API, when push is supported at all. */
  function notificationApi(): NotificationApi | undefined {
    const api = (globalThis as { Notification?: NotificationApi }).Notification;
    return registration ? api : undefined;
  }

  function serviceWorker(): Promise<ServiceWorkerRegistration> {
    if (!registration) throw new Error('Notifications are not supported in this browser.');
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
      const { pushManager } = await serviceWorker();
      const subscription =
        (await pushManager.getSubscription()) ??
        (await pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64url.decode(vapidPublicKey),
        }));
      made = subscription;
      return subscriptionInput(subscription);
    },

    async unsubscribe() {
      if (!registration) return null;
      // The browser's own answer covers a subscription made before this page loaded.
      const subscription = (await (await registration()).pushManager.getSubscription()) ?? made;
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

function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const { endpoint, keys } = subscription.toJSON();
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('The push subscription came without its endpoint or keys.');
  }
  return { endpoint, keys: { p256dh, auth }, platform: 'web' };
}
