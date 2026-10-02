import { describe, expect, it } from 'vitest';
import { nextPathFrom, signInPath } from './nextPath';

const ORIGIN = 'https://app.example';

describe('signInPath', () => {
  it('sends a visitor to sign-in, remembering where they were going', () => {
    expect(signInPath({ pathname: '/portfolio', search: '?tab=activity', hash: '' })).toBe(
      '/sign-in?next=%2Fportfolio%3Ftab%3Dactivity',
    );
    expect(signInPath({ pathname: '/', search: '', hash: '' })).toBe('/sign-in?next=%2F');
  });
});

describe('nextPathFrom', () => {
  it('goes on to a path in the app, with its query and its fragment', () => {
    expect(nextPathFrom('/portfolio?tab=activity', ORIGIN)).toBe('/portfolio?tab=activity');
    expect(nextPathFrom('/x?y#z', ORIGIN)).toBe('/x?y#z');
    expect(nextPathFrom('/', ORIGIN)).toBe('/');
  });

  it('reads the address as the browser would, against the page’s own origin', () => {
    expect(nextPathFrom(`${ORIGIN}/portfolio`, ORIGIN)).toBe('/portfolio');
    expect(nextPathFrom('/a/../legacy', ORIGIN)).toBe('/legacy');
  });

  it('goes home when there is no next', () => {
    expect(nextPathFrom(null, ORIGIN)).toBe('/');
    expect(nextPathFrom('', ORIGIN)).toBe('/');
  });

  it.each([
    ['another site', 'https://evil.example/'],
    ['another site, scheme-relative', '//evil.example/x'],
    ['a backslash the browser reads as a slash', '/\\evil.example'],
    // ?next=%2F%09%2Fevil.example: the browser drops tabs and line breaks, leaving //evil.example.
    ['a tab', '/\t/evil.example'],
    ['a line break', '/\r\n/evil.example'],
    ['a script', 'javascript:alert(1)'],
    // Dot segments the browser removes, leaving a path that starts with two slashes.
    ['a dot segment', '/.//evil.example'],
    ['a parent segment', '/a/..//evil.example'],
    ['an encoded dot segment', '/%2e//evil.example'],
    ['a parent segment at the root', '/..//evil.example'],
    ['data', 'data:text/html,hello'],
  ])('goes home rather than to %s', (_, next) => {
    expect(nextPathFrom(next, ORIGIN)).toBe('/');
  });

  it('goes home from an address that cannot be read', () => {
    for (const next of ['http://[', 'https://', 'http://a b', 'http://%']) {
      expect(nextPathFrom(next, ORIGIN)).toBe('/');
    }
  });

  it('goes home rather than back to sign-in', () => {
    for (const next of ['/sign-in', '/sign-in?next=%2F', '/sign-in/', '/Sign-In']) {
      expect(nextPathFrom(next, ORIGIN)).toBe('/');
    }
  });

  it('reads the page’s own origin when none is given', () => {
    expect(nextPathFrom(`${window.location.origin}/legacy`)).toBe('/legacy');
    expect(nextPathFrom('/\t/evil.example')).toBe('/');
  });
});
