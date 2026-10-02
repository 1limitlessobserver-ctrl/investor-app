// Where a signed-out visitor was going: carried to the sign-in screen as `?next=` and followed once
// signed in, but only within the app, so a link can never send the investor elsewhere.

const SIGN_IN = '/sign-in';

/** The sign-in screen, with the way back to `location`. */
export function signInPath(location: { pathname: string; search: string; hash: string }): string {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return `${SIGN_IN}?next=${encodeURIComponent(next)}`;
}

/** Where to go after signing in: `next` when it is a path in the app, else home. */
export function nextPathFrom(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/';
  }
  return next === SIGN_IN || next.startsWith(`${SIGN_IN}?`) || next.startsWith(`${SIGN_IN}/`)
    ? '/'
    : next;
}
