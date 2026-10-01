// The app-version gate: the platform answers 426 `upgrade_required` to an app below the
// administrator's minimum, and the app uses the same comparison to show its update screen early.

/**
 * The numeric parts of a version such as "1.2.3", "v1.2" or "1.2.3-beta.1+7", or null when the
 * text is not one. Like the platform's own check, a leading "v" and any "-prerelease" or "+build"
 * suffix are ignored, so "1.3.0-beta" counts as 1.3.0.
 */
function parts(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/, 1)[0] ?? '';
  const numbers = core.split('.');
  if (!numbers.every((part) => /^\d+$/.test(part))) return null;
  return numbers.map((part) => Number.parseInt(part, 10));
}

/** Compares part by part as numbers; a missing part is 0, so "1.2" equals "1.2.0". */
function order(a: number[], b: number[]): -1 | 0 | 1 {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * -1 when `a` is older than `b`, 1 when newer, 0 when equal. A value that is not a version has no
 * order, so a pair containing one is 0 ("not older"), which keeps every gate on this safe.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parts(a);
  const right = parts(b);
  return left && right ? order(left, right) : 0;
}

/**
 * True when `current` is older than `minimum`. A value that is not a version never counts as
 * below, so a bad `minSupportedAppVersion` (or a bad app version) can never lock an investor out.
 */
export function isBelowMinimum(current: string, minimum: string): boolean {
  const left = parts(current);
  const right = parts(minimum);
  return left !== null && right !== null && order(left, right) === -1;
}
