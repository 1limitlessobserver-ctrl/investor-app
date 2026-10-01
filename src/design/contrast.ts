/** Colour channels 0–255. */
export type Rgb = { r: number; g: number; b: number };
/** Hue 0–360 degrees; saturation and lightness 0–100 per cent. */
export type Hsl = { h: number; s: number; l: number };

const HEX = /^#[0-9a-f]{6}$/i;

export function hexToRgb(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`Expected a colour like #6EA8FF, got "${hex}"`);
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/** Rounds and clamps each channel, and writes lower-case `#rrggbb`. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// The HSL conversions follow CSS Color 4 (https://www.w3.org/TR/css-color-4/#hsl-to-rgb).
export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: light * 100 };
  const sat = (max - light) / Math.min(light, 1 - light);
  const hue =
    max === red
      ? (green - blue) / d + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / d + 2
        : (red - green) / d + 4;
  return { h: hue * 60, s: sat * 100, l: light * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return rgbToHex({ r: channel(0), g: channel(8), b: channel(4) });
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours, from 1 to 21, in either order. */
export function contrast(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
