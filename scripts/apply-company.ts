import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadCompanyConfig, type CompanyConfig } from './company-config';
import { generateIcons } from './generate-icons';

export function securityHeaders(platformUrl: string): string[] {
  const connect = platformUrl ? `'self' ${platformUrl}` : "'self'";
  const frame = platformUrl ? platformUrl : "'none'";
  return [
    `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; frame-src ${frame}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Strict-Transport-Security: max-age=63072000; includeSubDomains',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: no-referrer',
    'Permissions-Policy: camera=(self), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(self)',
  ];
}

export async function applyCompany(
  config: CompanyConfig,
  { root = process.cwd() } = {},
): Promise<{ written: string[] }> {
  const written: string[] = [];
  const p = (rel: string) => path.join(root, rel);

  written.push(...(await generateIcons(p(config.icon), p('public/icons'), config.backgroundColor)));

  const headers = securityHeaders(config.platformUrl);
  await writeFile(
    p('public/_headers'),
    [
      '/*',
      ...headers.map((h) => `  ${h}`),
      '',
      '/sw.js',
      '  Cache-Control: no-cache',
      '',
      '/manifest.webmanifest',
      '  Content-Type: application/manifest+json',
      '',
    ].join('\n'),
  );
  written.push(p('public/_headers'));

  await writeFile(
    p('vercel.json'),
    JSON.stringify(
      {
        headers: [
          {
            source: '/(.*)',
            headers: headers.map((h) => {
              const [key, ...rest] = h.split(': ');
              return { key, value: rest.join(': ') };
            }),
          },
          { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  written.push(p('vercel.json'));

  await writeFile(
    p('.env.production'),
    [
      `VITE_PLATFORM_URL=${config.platformUrl}`,
      `VITE_PRODUCT_NAME=${config.productName}`,
      `VITE_SHORT_NAME=${config.shortName}`,
      // Quoted: Vite's dotenv reads a bare `#6EA8FF` as a comment, so the value would be empty.
      `VITE_ACCENT_FALLBACK="${config.accentFallback}"`,
      '',
    ].join('\n'),
  );
  written.push(p('.env.production'));

  const html = (await readFile(p('index.html'), 'utf8'))
    .replace(/<title>.*?<\/title>/, `<title>${config.productName}</title>`)
    .replace(/(<meta name="application-name" content=").*?(")/, `$1${config.productName}$2`)
    .replace(/(<meta name="theme-color" content=").*?(")/, `$1${config.accentFallback}$2`);
  await writeFile(p('index.html'), html);
  written.push(p('index.html'));
  return { written };
}

// `main` is async so that a bad or missing config is reported as a message, not as a stack trace.
async function main(): Promise<void> {
  const { written } = await applyCompany(loadCompanyConfig());
  console.log(`apply-company: ${written.length} files`);
}

if (process.argv[1] && process.argv[1].endsWith('apply-company.ts')) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
