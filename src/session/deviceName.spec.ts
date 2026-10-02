import { describe, expect, it } from 'vitest';
import { deviceName } from './deviceName';

/** A user agent as browsers write it: the platform in brackets, then the engine and browser. */
const ua = (platform: string, rest: string) => `Mozilla/5.0 (${platform}) ${rest}`;
const BLINK = 'AppleWebKit/537.36 (KHTML, like Gecko)';
const WEBKIT = 'AppleWebKit/605.1.15 (KHTML, like Gecko)';
const WINDOWS = 'Windows NT 10.0; Win64; x64';
const IPHONE = 'iPhone; CPU iPhone OS 17_6 like Mac OS X';

describe('deviceName', () => {
  it.each([
    [ua(WINDOWS, `${BLINK} Chrome/129.0.0.0 Safari/537.36`), 'Chrome on Windows'],
    [ua(WINDOWS, `${BLINK} Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52`), 'Edge on Windows'],
    [ua(WINDOWS, `${BLINK} Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0`), 'Opera on Windows'],
    [
      ua('Macintosh; Intel Mac OS X 14.6; rv:130.0', 'Gecko/20100101 Firefox/130.0'),
      'Firefox on macOS',
    ],
    [
      ua('Macintosh; Intel Mac OS X 10_15_7', `${WEBKIT} Version/17.6 Safari/605.1.15`),
      'Safari on macOS',
    ],
    [ua(IPHONE, `${WEBKIT} Version/17.6 Mobile/15E148 Safari/604.1`), 'Safari on iPhone'],
    [ua(IPHONE, `${WEBKIT} CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1`), 'Chrome on iPhone'],
    [ua(IPHONE, `${WEBKIT} FxiOS/130.0 Mobile/15E148 Safari/605.1.15`), 'Firefox on iPhone'],
    [
      ua('iPad; CPU OS 17_6 like Mac OS X', `${WEBKIT} Version/17.6 Mobile/15E148 Safari/604.1`),
      'Safari on iPad',
    ],
    [
      ua('Linux; Android 10; K', `${BLINK} Chrome/129.0.0.0 Mobile Safari/537.36`),
      'Chrome on Android',
    ],
    [
      ua(
        'Linux; Android 14; SM-S918B',
        `${BLINK} SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`,
      ),
      'Samsung Internet on Android',
    ],
    [
      ua('X11; CrOS x86_64 14541.0.0', `${BLINK} Chrome/129.0.0.0 Safari/537.36`),
      'Chrome on ChromeOS',
    ],
    [
      ua('X11; Linux x86_64', `${BLINK} HeadlessChrome/141.0.7390.37 Safari/537.36`),
      'Chrome on Linux',
    ],
  ])('names %s', (userAgent, name) => {
    expect(deviceName(userAgent)).toBe(name);
  });

  it('says what it knows of an unfamiliar browser', () => {
    expect(deviceName(ua('X11; Linux x86_64', 'SomethingNew/1.0'))).toBe('Web browser on Linux');
    expect(deviceName('curl/8.9.1')).toBe('Web browser');
    expect(deviceName('')).toBe('Web browser');
  });
});
