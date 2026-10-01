import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const SIZES = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-512-maskable.png', size: 512, pad: 0.1 }, // safe zone: 10% padding each side
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
];
const BADGE = { file: 'badge-96.png', size: 96 };

// Android draws a notification badge from its alpha channel alone, so an opaque icon would show as a
// flat square. The badge is a white silhouette instead: each pixel's alpha is its distance from the
// background colour, scaled so the farthest colour (the mark) is fully opaque. The linear kernel
// never overshoots the mark's colour, which Lanczos does: that would leave the mark short of full
// alpha and put a faint halo of alpha around it.
async function writeBadge(
  source: string,
  target: string,
  size: number,
  background: string,
): Promise<void> {
  // The background colour as numbers; sharp parses the string, so any colour it accepts works.
  const [bgR = 0, bgG = 0, bgB = 0] = await sharp({
    create: { width: 1, height: 1, channels: 3, background },
  })
    .raw()
    .toBuffer();
  const icon = await sharp(source)
    .resize(size, size, { fit: 'contain', background, kernel: 'linear' })
    .png()
    .toBuffer();
  const flat = await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: icon }])
    .raw()
    .toBuffer();

  const distances: number[] = [];
  for (let at = 0; at < flat.length; at += 4) {
    const [r = 0, g = 0, b = 0] = flat.subarray(at, at + 3);
    distances.push(Math.hypot(r - bgR, g - bgG, b - bgB));
  }
  const farthest = distances.reduce((max, d) => Math.max(max, d), 1);
  const silhouette = Buffer.alloc(flat.length, 255); // white; the alpha bytes are set next
  distances.forEach((d, i) => {
    silhouette[i * 4 + 3] = Math.round((255 * d) / farthest);
  });
  await sharp(silhouette, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(target);
}

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
  const badge = path.join(outDir, BADGE.file);
  await writeBadge(source, badge, BADGE.size, background);
  written.push(badge);
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
