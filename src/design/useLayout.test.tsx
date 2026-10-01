import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { useLayout } from './useLayout';

describe('useLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is phone below 900 px', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('phone');
    expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 900px)');
  });

  it('is wide at 900 px and above', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('wide');
  });

  it('follows the viewport across the breakpoint and stops listening on unmount', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useLayout());
    media.change(true);
    expect(result.current).toBe('wide');
    media.change(false);
    expect(result.current).toBe('phone');
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
