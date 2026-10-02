// The app's service worker, built by vite-plugin-pwa (injectManifest: vite.config.ts) into
// dist/sw.js with the build's precache list in place of self.__WB_MANIFEST. It precaches the app
// shell (the HTML, the hashed scripts and styles, the latin fonts, the icons and the manifest) and
// answers every navigation with the shell, so the app opens offline; API calls are never cached
// (every platform answer is no-store) and /api navigations go to the network. Once active it takes
// control of the open pages, a first visit's too. A new version waits until the investor chooses
// Reload (UpdateToast), which posts SKIP_WAITING. That, the activation, pushes and taps on their
// notifications are handled in src/pwa/handlers.ts.
//
// Typechecked on its own (tsconfig.sw.json) with the WebWorker library instead of the DOM's,
// which the app project excludes it from.

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { onActivate, onMessage, onNotificationClick, onPush } from './pwa/handlers';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/_api\//],
  }),
);

// Its own clientsClaim(): workbox-core, which has one, is not among the app's dependencies.
self.addEventListener('activate', (event) => onActivate(self, event));
self.addEventListener('message', (event) => onMessage(self, event));
self.addEventListener('push', (event) => onPush(self, event));
self.addEventListener('notificationclick', (event) => onNotificationClick(self, event));
