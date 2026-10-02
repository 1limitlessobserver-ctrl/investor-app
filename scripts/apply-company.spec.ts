import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadEnv } from 'vite';
import { companyConfigSchema, loadCompanyConfig } from './company-config';
import { buildManifest } from './manifest';
import { applyCompany } from './apply-company';

const northwind = {
  platformUrl: 'https://invest.northwind.example',
  productName: 'Northwind Invest',
  shortName: 'Northwind',
  identifier: 'example.northwind.invest',
  icon: 'branding/icon.png',
  accentFallback: '#1F9E76',
  backgroundColor: '#05070F',
};

describe('company config', () => {
  it('accepts the template config and refuses a bad identifier', () => {
    expect(companyConfigSchema.safeParse(northwind).success).toBe(true);
    expect(companyConfigSchema.safeParse({ ...northwind, identifier: 'Not Valid!' }).success).toBe(
      false,
    );
    expect(
      companyConfigSchema.safeParse({ ...northwind, platformUrl: 'http://insecure.example' })
        .success,
    ).toBe(false);
    expect(
      companyConfigSchema.safeParse({ ...northwind, platformUrl: 'https://a.example/' }).success,
    ).toBe(false);
    expect(companyConfigSchema.safeParse({ ...northwind, platformUrl: '' }).success).toBe(true);
  });

  it('builds a manifest from the config', () => {
    const m = buildManifest(northwind);
    expect(m.name).toBe('Northwind Invest');
    expect(m.short_name).toBe('Northwind');
    expect(m.id).toBe('/');
    expect(m.start_url).toBe('/?source=pwa');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#1F9E76');
    expect(m.background_color).toBe('#05070F');
    expect(m.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        }),
        expect.objectContaining({
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        }),
        expect.objectContaining({
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          purpose: 'maskable',
        }),
      ]),
    );
  });

  it('lists the screenshots of scripts/screenshots.ts, a phone and a desktop one', () => {
    expect(buildManifest(northwind).screenshots).toEqual([
      expect.objectContaining({
        src: '/screenshots/phone-home.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
      }),
      expect.objectContaining({
        src: '/screenshots/desktop-home.png',
        sizes: '1920x1080',
        type: 'image/png',
        form_factor: 'wide',
      }),
    ]);
  });
});

describe('applyCompany', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'investor-app-'));
    await mkdir(path.join(root, 'branding'), { recursive: true });
    await mkdir(path.join(root, 'public'), { recursive: true });
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#1F9E76' } })
      .png()
      .toFile(path.join(root, 'branding/icon.png'));
    await writeFile(
      path.join(root, 'index.html'),
      '<!doctype html><html><head><title>__PRODUCT_NAME__</title><meta name="application-name" content="__PRODUCT_NAME__"><meta name="theme-color" content="__ACCENT__"></head><body></body></html>',
    );
    await writeFile(path.join(root, 'company.config.json'), JSON.stringify(northwind));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes icons, headers, env and index.html for a fictitious company', async () => {
    const result = await applyCompany(loadCompanyConfig(path.join(root, 'company.config.json')), {
      root,
    });
    for (const f of [
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/icon-512-maskable.png',
      'public/icons/apple-touch-icon.png',
      'public/icons/badge-96.png',
      'public/_headers',
      'vercel.json',
      '.env.production',
    ]) {
      expect((await stat(path.join(root, f))).isFile(), f).toBe(true);
    }
    const meta = await sharp(path.join(root, 'public/icons/icon-512-maskable.png')).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
    expect(headers).toContain("connect-src 'self' https://invest.northwind.example");
    expect(headers).toContain('frame-ancestors');
    const env = await readFile(path.join(root, '.env.production'), 'utf8');
    expect(env).toContain('VITE_PLATFORM_URL=https://invest.northwind.example');
    expect(env).toContain('VITE_PRODUCT_NAME=Northwind Invest');
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('<title>Northwind Invest</title>');
    expect(html).toContain('content="#1F9E76"');
    expect(html).not.toContain('__PRODUCT_NAME__');
    expect(result.written.length).toBeGreaterThanOrEqual(8);
  });

  it('lets the worker run and serves it and the manifest right, on both hosts', async () => {
    await applyCompany(northwind, { root });
    const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
    expect(headers).toContain("worker-src 'self'");
    expect(headers).toContain("manifest-src 'self'");
    expect(headers).toContain('/sw.js\n  Cache-Control: no-cache\n');
    expect(headers).toContain('/manifest.webmanifest\n  Content-Type: application/manifest+json\n');
    const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const rule = (source: string) => vercel.headers.find((r) => r.source === source)?.headers;
    expect(rule('/(.*)')).toContainEqual({
      key: 'Content-Security-Policy',
      value: expect.stringContaining("worker-src 'self'") as string,
    });
    expect(rule('/sw.js')).toEqual([{ key: 'Cache-Control', value: 'no-cache' }]);
    expect(rule('/manifest.webmanifest')).toEqual([
      { key: 'Content-Type', value: 'application/manifest+json' },
    ]);
  });

  it('keeps sample mode when platformUrl is empty', async () => {
    await writeFile(
      path.join(root, 'company.config.json'),
      JSON.stringify({ ...northwind, platformUrl: '' }),
    );
    await applyCompany(loadCompanyConfig(path.join(root, 'company.config.json')), { root });
    const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
    expect(headers).toContain("connect-src 'self';");
    expect(await readFile(path.join(root, '.env.production'), 'utf8')).toContain(
      'VITE_PLATFORM_URL=\n',
    );
  });

  it('writes an env file that Vite reads back unchanged', async () => {
    await applyCompany(northwind, { root });
    expect(loadEnv('production', root, 'VITE_')).toEqual({
      VITE_PLATFORM_URL: 'https://invest.northwind.example',
      VITE_PRODUCT_NAME: 'Northwind Invest',
      VITE_SHORT_NAME: 'Northwind',
      VITE_ACCENT_FALLBACK: '#1F9E76',
    });
  });

  it('refuses an invalid config with a message that names every bad field', async () => {
    const file = path.join(root, 'invalid.config.json');
    await writeFile(
      file,
      JSON.stringify({
        ...northwind,
        platformUrl: 'http://insecure.example',
        accentFallback: 'blue',
      }),
    );
    expect(() => loadCompanyConfig(file)).toThrow(
      'company.config.json is invalid:\n' +
        'platformUrl: HTTPS origin without a path or trailing slash\n' +
        'accentFallback: hex colour like #6EA8FF',
    );
  });
});
