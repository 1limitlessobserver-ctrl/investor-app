import { useSyncExternalStore } from 'react';

const WIDE = '(min-width: 900px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isWide(): boolean {
  return window.matchMedia(WIDE).matches;
}

/** `'wide'` (navigation rail, content column, split panes) at 900 px and above, else `'phone'`. */
export function useLayout(): 'phone' | 'wide' {
  return useSyncExternalStore(subscribe, isWide) ? 'wide' : 'phone';
}
