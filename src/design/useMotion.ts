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

function canAnimate(): boolean {
  const reduced = window.matchMedia(REDUCED).matches || forcedReduced();
  return motion(reduced, document.visibilityState === 'hidden').animate;
}

/** Whether decorative motion may run now; follows the system setting and the app's visibility. */
export function useMotion(): { animate: boolean } {
  const animate = useSyncExternalStore(subscribe, canAnimate);
  return useMemo(() => ({ animate }), [animate]);
}
