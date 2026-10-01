import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { generateIcons } from './generate-icons';

const ARTWORK = '#1F9E76';
const BACKGROUND = '#05070F';

async function pixel(file: string, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  const [r = 0, g = 0, b = 0] = data.subarray(at, at + 3);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

describe('generateIcons', () => {
  let dir: string;
  let written: string[];
  const out = (name: string) => path.join(dir, 'out', name);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'investor-icons-'));
    const source = path.join(dir, 'icon.png');
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: ARTWORK } })
      .png()
      .toFile(source);
    written = await generateIcons(source, path.join(dir, 'out'), BACKGROUND);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the five icon sizes', async () => {
    const sizes = await Promise.all(
      written.map(async (file) => {
        const { width, height } = await sharp(file).metadata();
        return `${path.basename(file)} ${width}x${height}`;
      }),
    );
    expect(sizes).toEqual([
      'icon-192.png 192x192',
      'icon-512.png 512x512',
      'icon-512-maskable.png 512x512',
      'apple-touch-icon.png 180x180',
      'badge-96.png 96x96',
    ]);
  });

  it('fills regular icons edge to edge and keeps a safe zone on the maskable one', async () => {
    expect(await pixel(out('icon-512.png'), 2, 256)).toBe(ARTWORK);
    expect(await pixel(out('icon-512-maskable.png'), 2, 256)).toBe(BACKGROUND);
    expect(await pixel(out('icon-512-maskable.png'), 48, 256)).toBe(BACKGROUND);
    expect(await pixel(out('icon-512-maskable.png'), 54, 256)).toBe(ARTWORK);
    expect(await pixel(out('icon-512-maskable.png'), 256, 256)).toBe(ARTWORK);
  });
});
