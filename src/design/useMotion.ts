import { useMemo, useSyncExternalStore } from 'react';
import { motion } from './motion';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** A dev flag: the audits set it to '1' to force reduced motion. */
const FORCE_REDUCED = 'app.forceReducedMotion';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    query.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

function forcedReduced(): boolean {
  try {
    return localStorage.getItem(FORCE_REDUCED) === '1';
  } catch {
    return false; // storage blocked: nothing can have set the flag
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED).matches || forcedReduced();
}

function canAnimate(): boolean {
  return motion(prefersReducedMotion(), document.visibilityState === 'hidden').animate;
}

function subscribeReduced(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether decorative motion may run now; follows the system setting and the app's visibility. */
export function useMotion(): { animate: boolean } {
  const animate = useSyncExternalStore(subscribe, canAnimate);
  return useMemo(() => ({ animate }), [animate]);
}

/**
 * Whether the investor asked for reduced motion (or the audits force it), whatever the app's
 * visibility: for an entrance that should not replay when the app comes back on screen.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion);
}
