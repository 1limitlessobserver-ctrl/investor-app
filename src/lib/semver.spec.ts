import { describe, it, expect } from 'vitest';
import { compareSemver, isBelowMinimum } from './semver';

describe('semver', () => {
  it('compares versions numerically', () => {
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });
  it('gates the app version', () => {
    expect(isBelowMinimum('1.2.0', '1.3.0')).toBe(true);
    expect(isBelowMinimum('1.3.0', '1.3.0')).toBe(false);
    expect(isBelowMinimum('garbage', '1.0.0')).toBe(false); // an unparsable value never locks the investor out
  });
});

describe('semver edge cases', () => {
  it('treats a missing part as zero', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('2', '1.9.9')).toBe(1);
    expect(isBelowMinimum('1.2', '1.2.1')).toBe(true);
  });
  it('ignores a leading v, spaces and a prerelease or build suffix, as the platform does', () => {
    expect(compareSemver('v1.3.0', '1.3.0')).toBe(0);
    expect(compareSemver('v1.4.0', '1.3.0')).toBe(1);
    expect(isBelowMinimum('v1.2.0', '1.3.0')).toBe(true);
    expect(compareSemver(' 1.3.0 ', '1.3.0')).toBe(0);
    expect(compareSemver('1.3.0-beta.1', '1.3.0')).toBe(0);
    expect(compareSemver('1.3.0+42', '1.3.0')).toBe(0);
    expect(isBelowMinimum('1.2.9-rc.1', '1.3.0')).toBe(true);
  });
  it('never orders a value that is not a version', () => {
    for (const bad of ['', 'garbage', '1.x.0', '1..0', '1.2.3.', '-1.0.0', '1.0.0 beta']) {
      expect(compareSemver(bad, '1.0.0'), bad).toBe(0);
      expect(compareSemver('1.0.0', bad), bad).toBe(0);
      expect(isBelowMinimum(bad, '1.0.0'), bad).toBe(false);
      expect(isBelowMinimum('0.0.1', bad), bad).toBe(false);
    }
  });
});
