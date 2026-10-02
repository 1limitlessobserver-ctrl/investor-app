// The platform the app runs on, picked once at startup: the web adapters for now. Sub-project 2
// adds the desktop ones and picks them when the app runs in its desktop shell.

import type { Platform } from './types';
import { webHaptics } from './web/haptics';
import { createWebInstall } from './web/install';
import { createLock } from './web/lock';
import { createWebNotifications } from './web/notifications';
import { createWebShare } from './web/share';
import { createSecureStorage } from './web/storage';

const storage = createSecureStorage();

export const platform: Platform = {
  kind: 'web',
  storage,
  lock: createLock({ storage, rpId: location.hostname, origin: location.origin }),
  notifications: createWebNotifications({
    // No service worker container outside a secure context, so no push. getRegistration()
    // answers undefined while no worker is registered, where `ready` would never settle.
    registration: navigator.serviceWorker
      ? () => navigator.serviceWorker.getRegistration()
      : undefined,
  }),
  share: createWebShare(),
  install: createWebInstall(),
  haptics: webHaptics,
};
