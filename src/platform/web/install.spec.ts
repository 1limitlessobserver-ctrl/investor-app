import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebInstall } from './install';

const mm = (standalone: boolean) =>
  ((q: string) => ({
    matches: q.includes('standalone') && standalone,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;

describe('install adapter', () => {
  it('offers the prompt only after beforeinstallprompt and reports the choice', async () => {
    const install = createWebInstall({
      userAgent: 'Chrome/130',
      platform: 'Win32',
      matchMedia: mm(false),
    });
    expect(install.canPrompt()).toBe(false);
    const listener = vi.fn();
    install.subscribe(listener);
    const ev = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(ev);
    expect(install.canPrompt()).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(await install.prompt()).toBe('accepted');
    expect(install.canPrompt()).toBe(false); // a prompt event is single use
  });
  it('knows when it is installed and which Safari hint applies', () => {
    expect(
      createWebInstall({
        userAgent: 'Chrome/130',
        platform: 'Win32',
        matchMedia: mm(true),
      }).isInstalled(),
    ).toBe(true);
    expect(
      createWebInstall({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        matchMedia: mm(false),
      }).hint(),
    ).toBe('safari-ios');
    expect(
      createWebInstall({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        matchMedia: mm(false),
      }).hint(),
    ).toBe('safari-mac');
    expect(
      createWebInstall({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        platform: 'MacIntel',
        matchMedia: mm(false),
      }).hint(),
    ).toBeNull();
    expect(
      createWebInstall({
        userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Safari/604.1',
        platform: 'iPhone',
        matchMedia: mm(true),
      }).hint(),
    ).toBeNull(); // already installed
  });
});

function promptEvent(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return { event, prompt };
}

const chromeOnWindows = { userAgent: 'Chrome/130', platform: 'Win32', matchMedia: mm(false) };
const safariOnMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const onIPhone = (browser: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${browser} Mobile/15E148 Safari/604.1`;

/** Gives navigator the values a browser reports; afterEach takes them away again. */
function browser(values: { userAgent?: string; platform?: string; maxTouchPoints?: number }) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(navigator, name, { configurable: true, value });
  }
}

describe('install adapter: prompts, installation and hints', () => {
  afterEach(() => {
    for (const name of ['userAgent', 'platform', 'maxTouchPoints']) {
      delete (navigator as unknown as Record<string, unknown>)[name];
    }
    vi.unstubAllGlobals();
  });

  it('answers unavailable without a prompt event', async () => {
    const install = createWebInstall(chromeOnWindows);
    expect(install.canPrompt()).toBe(false);
    expect(await install.prompt()).toBe('unavailable');
  });

  it("holds the browser's prompt back, uses the event once, reports a dismissal", async () => {
    const install = createWebInstall(chromeOnWindows);
    const { event, prompt } = promptEvent('dismissed');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(await install.prompt()).toBe('dismissed');
    expect(await install.prompt()).toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('keeps a prompt refused for want of a user gesture, for a later tap', async () => {
    const install = createWebInstall(chromeOnWindows);
    const listener = vi.fn();
    const leave = install.subscribe(listener);
    const prompt = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('No user gesture.', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    window.dispatchEvent(event);
    expect(await install.prompt()).toBe('unavailable');
    expect(install.canPrompt()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3); // offered, taken for the prompt, offered again
    expect(await install.prompt()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(install.canPrompt()).toBe(false);
    leave();
  });

  it('drops a prompt that fails for any other reason, such as one already used', async () => {
    const install = createWebInstall(chromeOnWindows);
    const prompt = vi.fn(() =>
      Promise.reject(new DOMException('The prompt can only be used once.', 'InvalidStateError')),
    );
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: new Promise(() => {}), // never answered: no prompt was shown
    });
    window.dispatchEvent(event);
    expect(await install.prompt()).toBe('unavailable');
    expect(install.canPrompt()).toBe(false);
    expect(await install.prompt()).toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('prompts once for a double tap: the second answers unavailable', async () => {
    const install = createWebInstall(chromeOnWindows);
    const { event, prompt } = promptEvent('accepted');
    window.dispatchEvent(event);
    expect(await Promise.all([install.prompt(), install.prompt()])).toEqual([
      'accepted',
      'unavailable',
    ]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('tells listeners of a prompt, its use and an installation until they leave', async () => {
    const install = createWebInstall(chromeOnWindows);
    const listener = vi.fn();
    const unsubscribe = install.subscribe(listener);
    window.dispatchEvent(promptEvent('accepted').event);
    expect(listener).toHaveBeenCalledTimes(1);
    await install.prompt();
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('appinstalled'));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    window.dispatchEvent(promptEvent('accepted').event);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('tells every listener, and still prompts, when one listener throws', async () => {
    const install = createWebInstall(chromeOnWindows);
    const uncaught: unknown[] = [];
    const report = (error: unknown) => {
      uncaught.push(error);
    };
    process.on('uncaughtException', report); // Vitest leaves an error with a listener to it
    const leaveFailing = install.subscribe(() => {
      throw new Error('listener bug');
    });
    const later = vi.fn();
    const leaveLater = install.subscribe(later);
    try {
      const { event, prompt } = promptEvent('accepted');
      window.dispatchEvent(event);
      expect(later).toHaveBeenCalledTimes(1);
      expect(install.canPrompt()).toBe(true);
      expect(await install.prompt()).toBe('accepted');
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(uncaught).toHaveLength(2)); // each reported on its own
    } finally {
      leaveFailing();
      leaveLater();
      process.off('uncaughtException', report);
    }
    expect(uncaught).toEqual([new Error('listener bug'), new Error('listener bug')]);
  });

  it('counts an appinstalled event as installed, and drops a prompt it held', () => {
    const install = createWebInstall({
      userAgent: safariOnMac,
      platform: 'MacIntel',
      matchMedia: mm(false),
    });
    window.dispatchEvent(promptEvent('accepted').event);
    expect(install.hint()).toBe('safari-mac');
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.isInstalled()).toBe(true);
    expect(install.canPrompt()).toBe(false);
    expect(install.hint()).toBeNull();
  });

  it('counts the iOS standalone flag as installed', () => {
    const install = createWebInstall({
      userAgent: onIPhone('Version/17.0'),
      platform: 'iPhone',
      matchMedia: mm(false),
    });
    expect(install.isInstalled()).toBe(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      expect(install.isInstalled()).toBe(true);
      expect(install.hint()).toBeNull();
    } finally {
      delete (navigator as { standalone?: boolean }).standalone;
    }
  });

  it('reads iPadOS Safari, which reports a Mac with a touch screen, as iOS', () => {
    const hint = (platform: string, maxTouchPoints: number) =>
      createWebInstall({
        userAgent: safariOnMac,
        platform,
        matchMedia: mm(false),
        maxTouchPoints,
      }).hint();
    expect(hint('MacIntel', 5)).toBe('safari-ios');
    expect(hint('MacIntel', 1)).toBe('safari-mac');
    expect(hint('MacIntel', 0)).toBe('safari-mac');
    expect(hint('iPad', 5)).toBe('safari-ios');
    expect(hint('iPod', 5)).toBe('safari-ios');
  });

  it('gives no hint in other browsers, on iOS or anywhere else', () => {
    const others: [string, string][] = [
      [onIPhone('CriOS/130.0.6723.90'), 'iPhone'],
      [onIPhone('FxiOS/131.0'), 'iPhone'],
      [onIPhone('EdgiOS/130.0.2849.80 Version/17.0'), 'iPhone'],
      [onIPhone('OPiOS/16.0.14.122053'), 'iPhone'],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'MacIntel',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0',
        'MacIntel',
      ],
      [
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        'Linux armv81',
      ],
      [safariOnMac, 'Win32'],
    ];
    for (const [userAgent, platform] of others) {
      expect(
        createWebInstall({ userAgent, platform, matchMedia: mm(false) }).hint(),
        userAgent,
      ).toBeNull();
    }
  });

  it("reads the browser's user agent, platform, touch points and display mode by default", () => {
    expect(createWebInstall().hint()).toBeNull(); // jsdom is no Safari
    browser({ userAgent: safariOnMac, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(createWebInstall().hint()).toBe('safari-mac');
    browser({ maxTouchPoints: 5 }); // iPadOS Safari reports a Mac with a touch screen
    expect(createWebInstall().hint()).toBe('safari-ios');
    browser({ userAgent: onIPhone('Version/17.0'), platform: 'iPhone' });
    const install = createWebInstall();
    expect(install.hint()).toBe('safari-ios');
    expect(install.isInstalled()).toBe(false);
    vi.stubGlobal('matchMedia', mm(true));
    expect(install.isInstalled()).toBe(true);
    expect(install.hint()).toBeNull();
  });
});
