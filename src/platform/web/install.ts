// Installing the app from the browser. Chrome and Edge offer an install prompt through the
// `beforeinstallprompt` event, which is held back here so the app can show it from its own Install
// button; Safari has none, so the app shows the manual steps instead (`hint()`). The app counts as
// installed when it runs standalone, or once the browser reports `appinstalled`.

import type { InstallAdapter } from '../types';

/** Chrome's install prompt event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: string }>;
}

/** Browsers whose user agent says Safari but that are not Safari. */
const NOT_SAFARI = /Chrome|CriOS|FxiOS|Edg|EdgiOS|OPiOS/;

/** Each option defaults to the browser's own; `maxTouchPoints` tells iPadOS from a Mac. */
export function createWebInstall(
  opts: {
    userAgent?: string | undefined;
    platform?: string | undefined;
    matchMedia?: typeof window.matchMedia | undefined;
    maxTouchPoints?: number | undefined;
  } = {},
): InstallAdapter {
  const userAgent = opts.userAgent ?? navigator.userAgent;
  const platform = opts.platform ?? navigator.platform;
  const maxTouchPoints = opts.maxTouchPoints ?? navigator.maxTouchPoints ?? 0;
  const matchMedia = opts.matchMedia ?? ((query: string) => window.matchMedia(query));
  let held: BeforeInstallPromptEvent | null = null;
  let installedNow = false;
  const listeners = new Set<() => void>();
  /**
   * Tells every listener. One that throws stops neither the others nor the prompt; its error is
   * reported on its own.
   */
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // no mini-infobar: the app offers the prompt itself
    held = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    held = null;
    notify();
  });

  function isInstalled(): boolean {
    return (
      installedNow ||
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  return {
    canPrompt: () => held !== null,

    async prompt() {
      const event = held;
      if (!event) return 'unavailable';
      held = null; // an event prompts once, and a second tap meanwhile finds none
      notify();
      try {
        await event.prompt();
      } catch (error) {
        // Refused for want of a user gesture, the event is still unused: keep it for a later tap.
        // Any other failure (a prompt already shown, for one) spends it.
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          held ??= event;
          notify();
        }
        return 'unavailable';
      }
      const { outcome } = await event.userChoice;
      return outcome === 'accepted' ? 'accepted' : 'dismissed';
    },

    isInstalled,

    hint() {
      if (isInstalled() || !userAgent.includes('Safari') || NOT_SAFARI.test(userAgent)) return null;
      const iPadAsMac = platform === 'MacIntel' && maxTouchPoints > 1;
      if (/^(iPhone|iPad|iPod)/.test(platform) || iPadAsMac) return 'safari-ios';
      return platform === 'MacIntel' ? 'safari-mac' : null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
