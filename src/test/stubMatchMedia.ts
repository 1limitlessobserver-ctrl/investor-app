import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Replaces `window.matchMedia` with one whose answer the test controls. `change(next)` flips the
 * answer and notifies every listener, as the browser does when the viewport or a setting changes.
 * Undo it with `vi.unstubAllGlobals()`.
 */
export function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((media: string) => ({
    media,
    get matches() {
      return matches;
    },
    addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    change(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}
