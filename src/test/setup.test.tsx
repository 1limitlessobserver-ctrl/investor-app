import { onlineManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { get, set } from 'idb-keyval';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Covers vitest.setup.ts. Vitest's `include` globs do not reach files in the repository root.

describe('vitest.setup', () => {
  describe('matchMedia stub', () => {
    const installed = Object.getOwnPropertyDescriptor(window, 'matchMedia');

    afterEach(() => {
      vi.unstubAllGlobals();
      if (installed) Object.defineProperty(window, 'matchMedia', installed);
    });

    it('is installed and reports that no query matches', () => {
      const query = window.matchMedia('(min-width: 900px)');
      expect(query.matches).toBe(false);
      expect(query.media).toBe('(min-width: 900px)');
    });

    it('takes and drops change listeners', () => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = vi.fn();
      query.addEventListener('change', onChange);
      query.removeEventListener('change', onChange);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('can be replaced by assignment', () => {
      window.matchMedia = (media) => ({ matches: true, media }) as MediaQueryList;
      expect(window.matchMedia('(min-width: 900px)').matches).toBe(true);
    });

    it('can be replaced with vi.stubGlobal', () => {
      vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media }));
      expect(window.matchMedia('(min-width: 900px)').matches).toBe(true);
    });
  });

  describe('Testing Library cleanup', () => {
    it('renders into the document', () => {
      render(<p>left behind</p>);
      expect(screen.getByText('left behind')).toBeInTheDocument();
    });

    it('starts the next test with an empty document', () => {
      expect(document.body).toBeEmptyDOMElement();
    });
  });

  describe('web storage', () => {
    it('keeps what a test stores for the rest of that test', () => {
      localStorage.setItem('app.theme', 'ivory');
      sessionStorage.setItem('app.sample', '1');
      expect(localStorage.getItem('app.theme')).toBe('ivory');
    });

    it('starts the next test on a fresh device', () => {
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe('the network and the page', () => {
    it('lets a test take the device offline and hide the page', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      onlineManager.setOnline(false);
      expect(navigator.onLine).toBe(false);
      expect(document.visibilityState).toBe('hidden');
    });

    it('starts the next test online, with the page in view', () => {
      expect(Object.hasOwn(navigator, 'onLine')).toBe(false);
      expect(navigator.onLine).toBe(true);
      expect(Object.hasOwn(document, 'visibilityState')).toBe(false);
      expect(document.visibilityState).toBe('visible');
      expect(onlineManager.isOnline()).toBe(true);
    });
  });

  describe('browser APIs', () => {
    it('offers Web Crypto with subtle', async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('investor'));
      expect(digest.byteLength).toBe(32);
    });

    it('offers an in-memory IndexedDB', async () => {
      await set('setup-spec', 'stored');
      expect(await get<string>('setup-spec')).toBe('stored');
    });
  });
});
