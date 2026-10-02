import { test, expect } from '@playwright/test';

/** The parts of the web manifest these tests read. */
interface Manifest {
  name: string;
  display: string;
  icons: { sizes: string; purpose?: string }[];
}

test('serves a valid manifest and registers the service worker', async ({ page, request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Manifest;
  expect(manifest.name).toBe('Investor App');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  await page.goto('/sign-in');
  const sw = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL,
  );
  expect(sw).toContain('/sw.js');
  expect(
    await page.evaluate(() =>
      fetch('/manifest.webmanifest').then((r) => r.headers.get('content-type')),
    ),
  ).toContain('application/manifest+json');
});

test('is installable according to Chrome', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP is Chromium only');
  await page.goto('/sign-in');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('shows the Safari hint in WebKit', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit');
  await page.goto('/sign-in');
  await expect(page.getByText(/Add to Home Screen|Add to Dock/)).toBeVisible();
});

test('keeps secrets encrypted in IndexedDB under a key that cannot be read out', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  // Sample mode keeps nothing in secure storage until a lock is set up: set the passcode the
  // first sign-in offers, and wait for the sheet to close (it closes once the passcode is saved).
  await page.getByRole('button', { name: 'Set a passcode' }).click();
  await page.getByLabel('Passcode', { exact: true }).fill('246810');
  await page.getByLabel('Repeat passcode').fill('246810');
  await page.getByRole('button', { name: 'Save passcode' }).click();
  await expect(page.getByRole('dialog', { name: 'Lock the app on this device' })).toBeHidden();
  const stored = await page.evaluate(
    () =>
      new Promise<{ key: boolean; sealed: boolean }>((resolve) => {
        const none = { key: false, sealed: false };
        const open = indexedDB.open('investor-app-secure');
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('secure')) return resolve(none);
          const store = db.transaction('secure').objectStore('secure');
          const key = store.get('secure:key');
          const passcode = store.get('secure:lock:passcode');
          passcode.onsuccess = () => {
            const value = passcode.result as { iv?: unknown; data?: unknown } | undefined;
            resolve({
              key: key.result instanceof CryptoKey && key.result.extractable === false,
              // Sealed: a 12-byte IV and ciphertext, never the record itself.
              sealed:
                value?.iv instanceof Uint8Array &&
                value.iv.length === 12 &&
                value.data instanceof Uint8Array &&
                !new TextDecoder().decode(value.data).includes('attempts'),
            });
          };
          passcode.onerror = () => resolve(none);
        };
        open.onerror = () => resolve(none);
      }),
  );
  expect(stored).toEqual({ key: true, sealed: true });
});
