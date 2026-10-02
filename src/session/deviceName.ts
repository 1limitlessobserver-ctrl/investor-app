// X-Device-Name: a short label for this browser in the platform's list of active sessions, such as
// "Chrome on Windows", read from the user agent. It is a convenience for the investor, never
// trusted for anything.

/** The browsers to name, in order: those built on Chrome or Safari give their own name first. */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|HeadlessChrome|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

/** The systems to name, tested in order: Android and ChromeOS say "Linux" too, iPads "Mac OS X". */
const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const MAX_LENGTH = 60;

const first = (rules: readonly [RegExp, string][], text: string): string | undefined =>
  rules.find(([pattern]) => pattern.test(text))?.[1];

/** "Chrome on Windows", "Safari on iPhone"; "Web browser" when the agent says too little. */
export function deviceName(userAgent: string): string {
  const browser = first(BROWSERS, userAgent) ?? 'Web browser';
  const system = first(SYSTEMS, userAgent);
  return (system === undefined ? browser : `${browser} on ${system}`).slice(0, MAX_LENGTH);
}
