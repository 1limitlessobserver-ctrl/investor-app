import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { useMotion, useReducedMotion } from './useMotion';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
    localStorage.clear();
  });

  it('animates when motion is allowed and the app is visible', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toEqual({ animate: true });
    expect(media.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('stays still when the system asks for reduced motion', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toEqual({ animate: false });
  });

  it('follows a change of the reduced-motion setting', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMotion());
    media.change(true);
    expect(result.current.animate).toBe(false);
    media.change(false);
    expect(result.current.animate).toBe(true);
  });

  it('stops while the app is hidden and resumes when it is visible again', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useMotion());
    setVisibility('hidden');
    expect(result.current.animate).toBe(false);
    setVisibility('visible');
    expect(result.current.animate).toBe(true);
  });

  it('stays still when the audits force reduced motion', () => {
    stubMatchMedia(false);
    localStorage.setItem('app.forceReducedMotion', '1');
    const { result } = renderHook(() => useMotion());
    expect(result.current.animate).toBe(false);
  });

  it('keeps the same result object until the answer changes', () => {
    const media = stubMatchMedia(false);
    const { result, rerender } = renderHook(() => useMotion());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    media.change(true);
    expect(result.current).not.toBe(first);
  });

  it('stops listening on unmount', () => {
    const media = stubMatchMedia(false);
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useMotion());
    unmount();
    expect(media.listeners.size).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  describe('useReducedMotion', () => {
    it('follows the system setting and the audits’ flag', () => {
      const media = stubMatchMedia(false);
      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);
      media.change(true);
      expect(result.current).toBe(true);
      media.change(false);
      localStorage.setItem('app.forceReducedMotion', '1');
      const forced = renderHook(() => useReducedMotion());
      expect(forced.result.current).toBe(true);
    });

    it('does not change while the app is hidden', () => {
      stubMatchMedia(false);
      const { result } = renderHook(() => useReducedMotion());
      setVisibility('hidden');
      expect(result.current).toBe(false);
    });
  });
});
