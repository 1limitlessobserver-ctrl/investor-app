import { test, expect } from '@playwright/test';

test('explores the sample world', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Sample', { exact: true })).toBeVisible();
});

test('signs in with the two-factor step', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('investor+2fa@sample.app');
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Six-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not valid.');
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/');
});

test('create account opens the company website in a new tab', async ({ page, context }) => {
  // The company's website is not the app's to test: answer it here, so no network is needed.
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Create account</title>' }),
  );
  await page.goto('/sign-in');
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Create account' }).click();
  expect((await popup).url()).toContain('example.com');
});

test('an outdated app sees the update screen and can still sign out', async ({ page }) => {
  await page.goto('/sign-in?sampleMinVersion=99.0.0');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await expect(page.getByRole('heading', { name: 'Update the app' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
