import { vi } from 'vitest';

/** Defines `name` on the prototype when jsdom leaves it out; a real implementation is kept. */
function provide<T extends object>(proto: T, name: string, value: unknown): void {
  if (!(name in proto)) Object.defineProperty(proto, name, { value, configurable: true });
}

/**
 * Adds the browser APIs jsdom lacks and Radix primitives call: ResizeObserver (Slider measures
 * its thumbs with it, and Switch its control inside a form), pointer capture (Select and Slider)
 * and scrollIntoView (Select keeps the highlighted option in view). Call it in a test file that
 * renders them. `vi.unstubAllGlobals()` removes the ResizeObserver; the prototype methods stay
 * for the rest of the file, whose worker is its own.
 */
export function stubRadixBrowserApis(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  provide(Element.prototype, 'scrollIntoView', () => {});
  provide(Element.prototype, 'hasPointerCapture', () => false);
  provide(Element.prototype, 'setPointerCapture', () => {});
  provide(Element.prototype, 'releasePointerCapture', () => {});
}
