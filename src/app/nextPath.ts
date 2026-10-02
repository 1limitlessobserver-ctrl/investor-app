// Where a signed-out visitor was going: carried to the sign-in screen as `?next=` and followed once
// signed in, but only within the app, so a link can never send the investor elsewhere.

const SIGN_IN = '/sign-in';

/** The sign-in screen, with the way back to `location`. */
export function signInPath(location: { pathname: string; search: string; hash: string }): string {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return `${SIGN_IN}?next=${encodeURIComponent(next)}`;
}

/**
 * Where to go after signing in: `next` when it is an address in the app, else home. It is read as
 * the browser reads an address (which drops tabs and line breaks, takes `\` for `/` and removes
 * dot segments), against the page's own origin, and kept only when it stays there: a path that
 * comes out starting with two slashes (`/.//evil.example` gives `//evil.example`) would name
 * another site when followed, so it leads home. Sign-in itself leads home: routes match without
 * regard to case.
 */
export function nextPathFrom(next: string | null, origin = window.location.origin): string {
  if (next === null || next === '') return '/';
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return '/';
  const path = url.pathname.toLowerCase();
  if (path === SIGN_IN || path.startsWith(`${SIGN_IN}/`)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
