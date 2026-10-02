import { test, expect } from '@playwright/test';

test('locks after five minutes in the background and unlocks with the passcode', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  // The lock-setup sheet offered on first sign-in (the passcode path in headless Chromium).
  await page.getByRole('button', { name: 'Set a passcode' }).click();
  // Exact: "Passcode" alone would also match "Repeat passcode".
  await page.getByLabel('Passcode', { exact: true }).fill('246810');
  await page.getByLabel('Repeat passcode').fill('246810');
  await page.getByRole('button', { name: 'Save passcode' }).click();
  // Saving stretches the passcode first, which takes real time. The faked five minutes pass at
  // once, so the app goes to the background only once the sheet has closed.
  await expect(page.getByRole('dialog', { name: 'Lock the app on this device' })).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward('05:01');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Locked' })).toBeVisible();
  await page.getByLabel('Passcode', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('4 attempts left');
  await page.getByLabel('Passcode', { exact: true }).fill('246810');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Locked' })).toBeHidden();
});
