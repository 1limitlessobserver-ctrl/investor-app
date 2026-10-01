/** Decorative motion runs only when the investor allows it and the app is on screen. */
export function motion(prefersReducedMotion: boolean, hidden: boolean): { animate: boolean } {
  return { animate: !prefersReducedMotion && !hidden };
}
