import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const SIZES = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-512-maskable.png', size: 512, pad: 0.1 }, // safe zone: 10% padding each side
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'badge-96.png', size: 96, pad: 0 },
];

export async function generateIcons(
  source: string,
  outDir: string,
  background = '#05070F',
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const { file, size, pad } of SIZES) {
    const inner = Math.round(size * (1 - 2 * pad));
    const icon = await sharp(source)
      .resize(inner, inner, { fit: 'contain', background })
      .png()
      .toBuffer();
    const target = path.join(outDir, file);
    await sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: icon, gravity: 'centre' }])
      .png()
      .toFile(target);
    written.push(target);
  }
  return written;
}

if (process.argv[1] && process.argv[1].endsWith('generate-icons.ts')) {
  generateIcons(process.argv[2] ?? 'branding/icon.png', process.argv[3] ?? 'public/icons')
    .then((files) => console.log(files.join('\n')))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
