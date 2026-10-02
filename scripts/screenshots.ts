// The web manifest's screenshots (public/screenshots/, listed by scripts/manifest.ts), which let
// Chrome show its richer install dialog: Home in the sample world, on a phone and on a desktop.
// It writes the company's files as the build does, then builds the app over the sample world
// (whatever company.config.json's platformUrl says) into a temporary folder, leaving dist/ alone;
// serves that with Vite's preview server on a free port; explores the sample world in Playwright's
// Chromium; and saves each shot at the size the manifest declares. Run it again after a change of
// branding (`npm run screenshots`) and commit the two files.

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { applyCompany } from './apply-company';
import { loadCompanyConfig } from './company-config';
import { SCREENSHOTS } from './manifest';

const OUT_DIR = 'public/screenshots';

type Shot = (typeof SCREENSHOTS)[number];

/** Signs in to the sample world on a fresh page, and saves Home as `shot`. */
async function capture(browser: Browser, origin: string, shot: Shot): Promise<string> {
  const phone = shot.formFactor === 'narrow';
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: shot.scale,
    isMobile: phone,
    hasTouch: phone,
    // A still sky, so the shot is the same each time it is taken.
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/sign-in`);
    await page.getByRole('button', { name: 'Explore with sample data' }).click();
    // The first sign-in offers the lock: not now.
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('dialog', { name: 'Lock the app on this device' }).waitFor({
      state: 'hidden',
    });
    await page.getByRole('heading', { name: 'Home' }).waitFor();
    // The figure, once the sample world has answered (a dash holds its place until then).
    await page.locator('[data-amount]').filter({ hasText: /\d/ }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT_DIR, shot.file);
    await page.screenshot({ path: file, animations: 'disabled' });
    return file;
  } finally {
    await context.close();
  }
}

/** Throws unless `file` is a PNG of the size the manifest declares for `shot`. */
async function checkSize(file: string, shot: Shot): Promise<void> {
  const { format, width, height } = await sharp(file).metadata();
  const [wide, high] = [shot.width * shot.scale, shot.height * shot.scale];
  if (format !== 'png' || width !== wide || height !== high) {
    throw new Error(
      `${file} is ${format} ${width}×${height}; the manifest says png ${wide}×${high}.`,
    );
  }
}

async function main(): Promise<void> {
  await applyCompany(loadCompanyConfig());
  // The sample world, whatever the company's platform: Vite prefers the environment to .env files.
  process.env.VITE_PLATFORM_URL = '';
  const outDir = await mkdtemp(path.join(tmpdir(), 'investor-app-screenshots-'));
  try {
    await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    const server = await preview({
      logLevel: 'warn',
      build: { outDir },
      preview: { port: 0, open: false },
    });
    try {
      const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
      if (origin === undefined) throw new Error('The preview server gave no address.');
      const browser = await chromium.launch();
      try {
        await mkdir(OUT_DIR, { recursive: true });
        for (const shot of SCREENSHOTS) {
          const file = await capture(browser, origin, shot);
          await checkSize(file, shot);
          console.log(`screenshots: ${file}`);
        }
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

// `main` is async so that a failure is reported as a message, not as a stack trace.
if (process.argv[1]?.endsWith('screenshots.ts')) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
