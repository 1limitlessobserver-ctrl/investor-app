import { contrast, hexToHsl, hexToRgb, hslToHex, rgbToHex } from './contrast';

export type ThemeId = 'orbital' | 'obsidian' | 'ivory' | 'aurora' | 'verdant' | 'aegis';

/** The colour tokens; `apply` writes each one as a `--kebab-case` CSS variable. */
const COLOUR_TOKENS = [
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

/** Every colour is `#rrggbb`. */
export type ThemeTokens = Record<(typeof COLOUR_TOKENS)[number], string> & {
  scheme: 'dark' | 'light';
  display: 'serif' | 'grotesk';
  radius: 'soft' | 'tight';
  starfield: boolean;
};

/** A company accent made readable on one theme. */
export type AccentTokens = {
  primary: string;
  primaryForeground: string;
  accentText: string;
  glow: string;
};

type Theme = { label: string; tokens: ThemeTokens };

const IDS: readonly ThemeId[] = ['orbital', 'obsidian', 'ivory', 'aurora', 'verdant', 'aegis'];

// The five website themes are ported from the platform's src/styles/summit-themes.css and
// src/styles/aegis.css: --s-bg → background, --s-panel → card and popup, --s-tint → surface and
// muted, --s-text → foreground, cardForeground and popupForeground, --s-muted → mutedForeground,
// --s-line → border, --s-good → success, --s-danger → error, --s-gold → signatureAccent. Every one
// of their text colours already reaches 4.5:1 on its background, card and surface, so none is
// nudged. The website has no warning or info colours; those are chosen per theme below.
const THEMES: Record<ThemeId, Theme> = {
  orbital: {
    label: 'Orbital',
    tokens: {
      background: '#05070f',
      foreground: '#ecf1ff',
      surface: '#0e1428',
      card: '#0b1020',
      cardForeground: '#ecf1ff',
      popup: '#121a33',
      popupForeground: '#ecf1ff',
      muted: '#1a2340',
      mutedForeground: '#a9b4d0',
      border: '#25304d',
      success: '#7ee2b8',
      error: '#ff9c9c',
      warning: '#f2c879',
      info: '#8fb8ff',
      signatureAccent: '#6ea8ff',
      scheme: 'dark',
      display: 'serif',
      radius: 'soft',
      starfield: true,
    },
  },
  // summit-themes.css `.summit[data-theme]`, the base block the other website themes override.
  obsidian: {
    label: 'Obsidian Sovereign',
    tokens: {
      background: '#101713',
      foreground: '#edf0eb',
      surface: '#202f27',
      card: '#18231e',
      cardForeground: '#edf0eb',
      popup: '#18231e',
      popupForeground: '#edf0eb',
      muted: '#202f27',
      mutedForeground: '#b4c1bd',
      border: '#59645c',
      success: '#a6e2b8',
      error: '#ffb5b5',
      // Chosen: amber hsl(34 85% 74%) and blue hsl(208 65% 78%), as light as the status pastels.
      warning: '#f5c484',
      info: '#a2c9eb',
      signatureAccent: '#dec590',
      scheme: 'dark',
      display: 'serif',
      radius: 'soft',
      starfield: false,
    },
  },
  ivory: {
    label: 'Ivory Estate',
    tokens: {
      background: '#f2efe5',
      foreground: '#25392e',
      surface: '#e6eadd',
      card: '#fffdf5',
      cardForeground: '#25392e',
      popup: '#fffdf5',
      popupForeground: '#25392e',
      muted: '#e6eadd',
      mutedForeground: '#506356',
      border: '#a3ac9c',
      success: '#225d3c',
      error: '#992c32',
      // Chosen: burnt orange hsl(28 86% 30%) and blue hsl(212 60% 34%), as deep as the status inks.
      warning: '#8e480b',
      info: '#23538b',
      signatureAccent: '#735124',
      scheme: 'light',
      display: 'serif',
      radius: 'soft',
      starfield: false,
    },
  },
  aurora: {
    label: 'Quantum Aurora',
    tokens: {
      background: '#111326',
      foreground: '#efedff',
      surface: '#292a4c',
      card: '#1a2037',
      cardForeground: '#efedff',
      popup: '#1a2037',
      popupForeground: '#efedff',
      muted: '#292a4c',
      mutedForeground: '#b8bddb',
      border: '#565e83',
      success: '#8ee9c4',
      error: '#ffb5c5',
      // Chosen: amber hsl(40 90% 76%) and periwinkle hsl(230 100% 84%), as light as the status pastels.
      warning: '#f9d48b',
      info: '#adbbff',
      signatureAccent: '#8de3df',
      scheme: 'dark',
      display: 'serif',
      radius: 'soft',
      starfield: true,
    },
  },
  verdant: {
    label: 'Verdant Real Assets',
    tokens: {
      background: '#0b211b',
      foreground: '#edf4e8',
      surface: '#214537',
      card: '#14342a',
      cardForeground: '#edf4e8',
      popup: '#14342a',
      popupForeground: '#edf4e8',
      muted: '#214537',
      mutedForeground: '#b5cbb9',
      border: '#53765e',
      success: '#b3e3a4',
      error: '#ffb7ab',
      // Chosen: amber hsl(40 80% 74%) and sky blue hsl(200 61% 78%), as light as the status pastels.
      warning: '#f2ce88',
      info: '#a5d2e9',
      signatureAccent: '#c9d99a',
      scheme: 'dark',
      display: 'serif',
      radius: 'soft',
      starfield: false,
    },
  },
  // aegis.css: its --surface (#0b121c) is --s-panel, so it becomes card; its --surface-raised
  // (#111d29) is --s-tint, so it becomes surface.
  aegis: {
    label: 'AEGIS / Orbital Command',
    tokens: {
      background: '#06090e',
      foreground: '#eaf3f9',
      surface: '#111d29',
      card: '#0b121c',
      cardForeground: '#eaf3f9',
      popup: '#0b121c',
      popupForeground: '#eaf3f9',
      muted: '#111d29',
      mutedForeground: '#a8bbcb',
      border: '#263745',
      success: '#a9dcc8',
      error: '#f39b9b',
      // warning is aegis.css --accent-attention. info is chosen: blue hsl(215 84% 80%).
      warning: '#e2b771',
      info: '#a1c5f7',
      signatureAccent: '#8be7f5',
      scheme: 'dark',
      display: 'grotesk',
      radius: 'tight',
      starfield: false,
    },
  },
};

const BLACK = '#000000';
const WHITE = '#ffffff';

/**
 * Moves the colour's HSL lightness by `step` (one per cent) at a time, keeping hue and saturation,
 * until `passes` holds or the colour reaches white or black. A colour that already passes comes back
 * unchanged.
 */
function shiftLightness(hex: string, step: 1 | -1, passes: (colour: string) => boolean): string {
  if (passes(hex)) return hex;
  const { h, s, l } = hexToHsl(hex);
  for (let lightness = l + step; ; lightness += step) {
    const colour = hslToHex({ h, s, l: Math.min(100, Math.max(0, lightness)) });
    if (passes(colour) || lightness <= 0 || lightness >= 100) return colour;
  }
}

/** The step toward the theme's foreground: lighter on dark themes, darker on light ones. */
function towardForeground(t: ThemeTokens): 1 | -1 {
  return t.scheme === 'dark' ? 1 : -1;
}

/**
 * Readable as text: at least 4.5:1 on every fill text sits on. Orbital's popup and muted fills are
 * lighter than its surface; on the website themes they repeat the card and surface.
 */
function readableText(hex: string, t: ThemeTokens): string {
  const fills = [t.background, t.card, t.surface, t.popup, t.muted];
  return shiftLightness(hex, towardForeground(t), (colour) =>
    fills.every((fill) => contrast(colour, fill) >= 4.5),
  );
}

/** Visible as a button: at least 3:1 on the background. */
function buttonFill(hex: string, t: ThemeTokens): string {
  return shiftLightness(hex, towardForeground(t), (colour) => contrast(colour, t.background) >= 3);
}

/**
 * Pure black or white, whichever contrasts more with the fill. Their two ratios multiply to 21 for
 * any colour, so the winner always reaches √21 ≈ 4.58:1 and the fill never has to move further.
 */
function buttonText(fill: string): string {
  return contrast(BLACK, fill) >= contrast(WHITE, fill) ? BLACK : WHITE;
}

function glow(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, 0.45)`;
}

function accent(accentHex: string, id: ThemeId): AccentTokens {
  const t = THEMES[id].tokens;
  const hex = rgbToHex(hexToRgb(accentHex));
  const accentText = readableText(hex, t);
  const primary = buttonFill(hex, t);
  return { primary, primaryForeground: buttonText(primary), accentText, glow: glow(accentText) };
}

/** `signatureAccent` → `--signature-accent`. */
function cssVariable(token: string): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * Writes the theme onto `root`: `data-theme`, `color-scheme`, every colour token and the accent
 * tokens as CSS variables, and, on `<html>`, the browser's theme colour. `display` and `radius`
 * follow from `data-theme` in tokens.css; the starfield reads `starfield` from `themes.tokens`.
 */
function apply(id: ThemeId, accentHex: string, root: HTMLElement = document.documentElement): void {
  const t = THEMES[id].tokens;
  const a = accent(accentHex, id);
  root.dataset.theme = id;
  root.style.setProperty('color-scheme', t.scheme);
  for (const token of COLOUR_TOKENS) root.style.setProperty(cssVariable(token), t[token]);
  for (const [token, value] of Object.entries(a)) root.style.setProperty(cssVariable(token), value);
  if (root === document.documentElement) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.primary);
  }
}

export const themes = {
  ids: IDS,
  label: (id: ThemeId): string => THEMES[id].label,
  tokens: (id: ThemeId): ThemeTokens => THEMES[id].tokens,
  accent,
  apply,
};
