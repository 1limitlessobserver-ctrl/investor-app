import { afterEach, describe, it, expect } from 'vitest';
import { themes } from './themes';
import { contrast, hexToHsl, rgbToHex } from './contrast';

const REQUIRED = [
  'background',
  'foreground',
  'surface',
  'card',
  'cardForeground',
  'popup',
  'popupForeground',
  'muted',
  'mutedForeground',
  'border',
  'success',
  'error',
  'warning',
  'info',
  'signatureAccent',
] as const;

describe('themes', () => {
  it('defines every token in all six themes', () => {
    expect(themes.ids).toEqual(['orbital', 'obsidian', 'ivory', 'aurora', 'verdant', 'aegis']);
    for (const id of themes.ids) {
      const t = themes.tokens(id) as unknown as Record<string, string>;
      for (const key of REQUIRED) expect(t[key], `${id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps body and muted text at WCAG AA on background, card and surface', () => {
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const surface of [t.background, t.card, t.surface]) {
        expect(contrast(t.foreground, surface), `${id} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.mutedForeground, surface), `${id} muted`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.popupForeground, t.popup), `${id} popup`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('makes any company accent readable as text and as a button', () => {
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const accent of [
        '#1F9E76',
        '#123456',
        '#E8F0A0',
        '#FF3B30',
        '#FFFFFF',
        '#000000',
        '#6EA8FF',
      ]) {
        const a = themes.accent(accent, id);
        for (const surface of [t.background, t.card, t.surface, t.popup, t.muted])
          expect(contrast(a.accentText, surface), `${id} ${accent} text`).toBeGreaterThanOrEqual(
            4.5,
          );
        expect(
          contrast(a.primaryForeground, a.primary),
          `${id} ${accent} button text`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(a.primary, t.background),
          `${id} ${accent} button on bg`,
        ).toBeGreaterThanOrEqual(3);
        expect(['#000000', '#FFFFFF']).toContain(a.primaryForeground.toUpperCase());
        expect(a.glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);
      }
    }
  });

  it('keeps an already readable accent unchanged', () => {
    expect(themes.accent('#7EE2B8', 'orbital').accentText.toUpperCase()).toBe('#7EE2B8');
  });

  it('applies a theme as CSS variables and attributes on the root', () => {
    const root = document.createElement('div');
    themes.apply('ivory', '#123456', root);
    expect(root.dataset.theme).toBe('ivory');
    expect(root.style.getPropertyValue('--background')).toBe(themes.tokens('ivory').background);
    expect(root.style.getPropertyValue('--primary')).toBe(
      themes.accent('#123456', 'ivory').primary,
    );
    expect(root.style.getPropertyValue('color-scheme')).toBe('light');
    themes.apply('orbital', '#123456', root);
    expect(root.style.getPropertyValue('color-scheme')).toBe('dark');
  });

  it('names the six themes', () => {
    expect(themes.ids.map((id) => themes.label(id))).toEqual([
      'Orbital',
      'Obsidian Sovereign',
      'Ivory Estate',
      'Quantum Aurora',
      'Verdant Real Assets',
      'AEGIS / Orbital Command',
    ]);
  });

  it('keeps text, status colours and the signature accent readable on every surface', () => {
    const TEXT = [
      'foreground',
      'mutedForeground',
      'cardForeground',
      'success',
      'error',
      'warning',
      'info',
      'signatureAccent',
    ] as const;
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const surface of [t.background, t.card, t.surface, t.popup, t.muted])
        for (const key of TEXT)
          expect(contrast(t[key], surface), `${id}.${key} on ${surface}`).toBeGreaterThanOrEqual(
            4.5,
          );
    }
  });

  it('makes every accent on an RGB grid readable in every theme', () => {
    const levels = [0, 51, 102, 153, 204, 255];
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      for (const r of levels)
        for (const g of levels)
          for (const b of levels) {
            const accent = rgbToHex({ r, g, b });
            const a = themes.accent(accent, id);
            const lowest = Math.min(
              ...[t.background, t.card, t.surface, t.popup, t.muted].map((s) =>
                contrast(a.accentText, s),
              ),
            );
            expect(lowest, `${id} ${accent} text`).toBeGreaterThanOrEqual(4.5);
            expect(
              contrast(a.primary, t.background),
              `${id} ${accent} button`,
            ).toBeGreaterThanOrEqual(3);
            expect(
              contrast(a.primaryForeground, a.primary),
              `${id} ${accent} label`,
            ).toBeGreaterThanOrEqual(4.5);
          }
    }
  });

  it('moves only the lightness, and only as far as it needs to', () => {
    const t = themes.tokens('orbital');
    // #FF3B30 is readable on background, card and surface; only the lighter muted fill lifts it.
    for (const accent of ['#123456', '#FF3B30']) {
      const text = themes.accent(accent, 'orbital').accentText;
      const before = hexToHsl(accent);
      const after = hexToHsl(text);
      expect(after.h, `${accent} hue`).toBeCloseTo(before.h, 0);
      expect(Math.abs(after.s - before.s), `${accent} saturation`).toBeLessThan(2);
      expect(after.l, `${accent} lightness`).toBeGreaterThan(before.l);
      const surfaces = [t.background, t.card, t.surface, t.popup, t.muted];
      const lowest = Math.min(...surfaces.map((s) => contrast(text, s)));
      expect(lowest, `${accent} lands just past 4.5:1`).toBeLessThan(4.8);
    }
  });

  it('takes the company accent on Orbital and the signature accent on the website themes', () => {
    expect(themes.accent('#6EA8FF', 'orbital').primary).toBe('#6ea8ff');
    expect(themes.accent('#123456', 'orbital')).not.toEqual(themes.accent('#6EA8FF', 'orbital'));
    const website = [
      ['obsidian', '#dec590', '#000000'],
      ['ivory', '#735124', '#ffffff'],
      ['aurora', '#8de3df', '#000000'],
      ['verdant', '#c9d99a', '#000000'],
      ['aegis', '#8be7f5', '#000000'],
    ] as const;
    for (const [id, signature, label] of website) {
      expect(themes.tokens(id).signatureAccent, id).toBe(signature);
      for (const company of ['#123456', '#6EA8FF', '#FF3B30'])
        expect(themes.accent(company, id), `${id} with ${company}`).toMatchObject({
          primary: signature,
          primaryForeground: label,
          accentText: signature,
        });
    }
    const root = document.createElement('div');
    themes.apply('ivory', '#123456', root);
    expect(root.style.getPropertyValue('--primary')).toBe('#735124');
    expect(root.style.getPropertyValue('--accent-text')).toBe('#735124');
  });

  it('rejects a malformed company accent on every theme, even one that shows its own', () => {
    for (const id of themes.ids)
      expect(() => themes.accent('red', id), id).toThrow('Expected a colour like #6EA8FF');
  });

  it('writes every colour token and accent token as a kebab-case variable', () => {
    const root = document.createElement('div');
    themes.apply('verdant', '#FF3B30', root);
    expect(Array.from(root.style)).toEqual([
      'color-scheme',
      '--background',
      '--foreground',
      '--surface',
      '--card',
      '--card-foreground',
      '--popup',
      '--popup-foreground',
      '--muted',
      '--muted-foreground',
      '--border',
      '--success',
      '--error',
      '--warning',
      '--info',
      '--signature-accent',
      '--primary',
      '--primary-foreground',
      '--accent-text',
      '--glow',
    ]);
    expect(root.style.getPropertyValue('--signature-accent')).toBe(
      themes.tokens('verdant').signatureAccent,
    );
    expect(root.style.getPropertyValue('--glow')).toBe(themes.accent('#FF3B30', 'verdant').glow);
  });

  describe('on <html>', () => {
    const html = document.documentElement;

    function themeColourMeta(): HTMLMetaElement {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#6EA8FF';
      document.head.append(meta);
      return meta;
    }

    afterEach(() => {
      html.removeAttribute('data-theme');
      html.removeAttribute('style');
      document.querySelector('meta[name="theme-color"]')?.remove();
    });

    it('applies there by default and sets the browser theme colour to the primary', () => {
      const meta = themeColourMeta();
      themes.apply('aegis', '#1F9E76');
      const a = themes.accent('#1F9E76', 'aegis');
      expect(html.dataset.theme).toBe('aegis');
      expect(html.style.getPropertyValue('--accent-text')).toBe(a.accentText);
      expect(meta.content).toBe(a.primary);
    });

    it('keeps the browser theme colour when another element is the root', () => {
      const meta = themeColourMeta();
      themes.apply('ivory', '#1F9E76', document.createElement('div'));
      expect(meta.content).toBe('#6EA8FF');
    });

    it('works without a theme-color meta', () => {
      themes.apply('obsidian', '#1F9E76');
      expect(html.dataset.theme).toBe('obsidian');
    });
  });
});
