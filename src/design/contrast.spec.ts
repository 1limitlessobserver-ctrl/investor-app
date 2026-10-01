import { describe, it, expect } from 'vitest';
import { contrast, hexToHsl, hexToRgb, hslToHex, relativeLuminance, rgbToHex } from './contrast';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
    expect(contrast('#05070F', '#ECF1FF')).toBeGreaterThan(17);
  });
  it('rejects malformed colours', () => {
    expect(() => contrast('red', '#fff')).toThrow();
  });
});

describe('colour conversions', () => {
  it('measures WCAG relative luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 4);
  });

  it('converts between hex, RGB and HSL', () => {
    expect(hexToRgb('#6EA8FF')).toEqual({ r: 110, g: 168, b: 255 });
    expect(rgbToHex({ r: 110, g: 168, b: 255 })).toBe('#6ea8ff');
    expect(rgbToHex({ r: -4, g: 127.6, b: 300 })).toBe('#0080ff');
    const navy = hexToHsl('#123456');
    expect(navy.h).toBe(210);
    expect(navy.s).toBeCloseTo(65.4, 1);
    expect(navy.l).toBeCloseTo(20.4, 1);
    const grey = hexToHsl('#808080');
    expect([grey.h, grey.s]).toEqual([0, 0]);
    expect(grey.l).toBeCloseTo(50.2, 1);
    expect(hslToHex({ h: 120, s: 100, l: 25 })).toBe('#008000');
    expect(hslToHex({ h: 210, s: 65.4, l: 100 })).toBe('#ffffff');
  });

  it('returns every colour on a 16-level grid unchanged after a trip through HSL', () => {
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          const hex = rgbToHex({ r, g, b });
          expect(hslToHex(hexToHsl(hex)), hex).toBe(hex);
        }
  });

  it('accepts only #rrggbb', () => {
    for (const bad of ['#fff', '6ea8ff', '#6ea8ff0', '#6ea8fg', ''])
      expect(() => hexToRgb(bad), bad).toThrow('Expected a colour like #6EA8FF');
  });
});
