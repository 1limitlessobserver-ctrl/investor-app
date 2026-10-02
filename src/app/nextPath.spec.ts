import { describe, expect, it } from 'vitest';
import { nextPathFrom, signInPath } from './nextPath';

describe('signInPath', () => {
  it('sends a visitor to sign-in, remembering where they were going', () => {
    expect(signInPath({ pathname: '/portfolio', search: '?tab=activity', hash: '' })).toBe(
      '/sign-in?next=%2Fportfolio%3Ftab%3Dactivity',
    );
    expect(signInPath({ pathname: '/', search: '', hash: '' })).toBe('/sign-in?next=%2F');
  });
});

describe('nextPathFrom', () => {
  it('goes on to a path in the app', () => {
    expect(nextPathFrom('/portfolio?tab=activity')).toBe('/portfolio?tab=activity');
    expect(nextPathFrom('/')).toBe('/');
  });

  it('goes home when there is none, or it leads out of the app or back to sign-in', () => {
    for (const raw of [
      null,
      '',
      'portfolio',
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      '/sign-in?next=%2F',
    ]) {
      expect(nextPathFrom(raw)).toBe('/');
    }
  });
});
