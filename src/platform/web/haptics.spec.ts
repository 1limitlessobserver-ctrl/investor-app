import { describe, it, expect, vi, afterEach } from 'vitest';
import { webHaptics } from './haptics';

describe('web haptics', () => {
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it('vibrates a short tick, a success pattern and a warning pattern', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    webHaptics.tick();
    webHaptics.success();
    webHaptics.warn();
    expect(vibrate.mock.calls).toEqual([[10], [[10, 40, 10]], [[30, 30, 30]]]);
  });

  it('stays silent, and never throws, where the browser cannot vibrate (Safari)', () => {
    expect('vibrate' in navigator).toBe(false); // jsdom, like Safari, has no vibrate()
    expect(() => {
      webHaptics.tick();
      webHaptics.success();
      webHaptics.warn();
    }).not.toThrow();
  });
});
