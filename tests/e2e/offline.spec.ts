import { test, expect } from '@playwright/test';

test('opens the shell offline, hides balances and recovers', async ({ page, context }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  // The ribbon shows on the sign-in screen too: wait for the session itself, which offers the lock.
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Sample', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status', { name: 'Connection' })).toHaveText(/You're offline/);
  await expect(page.locator('[data-amount]').first()).toHaveText('•••');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status', { name: 'Connection' })).toBeHidden();
  await expect(page.locator('[data-amount]').first()).not.toHaveText('•••');
});
