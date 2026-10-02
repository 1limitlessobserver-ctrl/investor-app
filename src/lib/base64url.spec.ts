import { describe, it, expect } from 'vitest';
import { base64url } from './base64url';

// The bytes of ASCII text. (TextEncoder's arrays come from another realm under jsdom, and toEqual
// compares constructors.)
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('base64url', () => {
  it('encodes the RFC 4648 test vectors without padding, and decodes them back', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, encoded] of vectors) {
      expect(base64url.encode(ascii(text)), text).toBe(encoded);
      expect(base64url.decode(encoded), encoded).toEqual(ascii(text));
    }
  });

  it('writes the URL-safe alphabet: "-" and "_", never "+", "/" or "="', () => {
    expect(base64url.encode(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe('----');
    expect(base64url.encode(new Uint8Array([0xff, 0xff, 0xff]))).toBe('____');
    expect(base64url.encode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    // Every byte value once: the standard alphabet would need all 64 characters, "+" and "/" too.
    const everyByte = base64url.encode(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(everyByte).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(everyByte).toContain('-');
    expect(everyByte).toContain('_');
  });

  it('decodes padded and unpadded text in either alphabet', () => {
    for (const text of ['-_8', '-_8=', '+/8', '+/8=']) {
      expect(base64url.decode(text), text).toEqual(new Uint8Array([0xfb, 0xff]));
    }
    expect(base64url.decode('Zg==')).toEqual(ascii('f'));
    expect(base64url.decode('Zm8=')).toEqual(ascii('fo'));
  });

  it('round-trips random bytes of every length up to 64, and a long buffer', () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const encoded = base64url.encode(bytes);
      expect(encoded, String(length)).not.toMatch(/[+/=]/);
      expect(base64url.decode(encoded), String(length)).toEqual(bytes);
    }
    const long = crypto.getRandomValues(new Uint8Array(65_536));
    expect(base64url.decode(base64url.encode(long))).toEqual(long);
  });

  it('encodes and decodes an empty input', () => {
    expect(base64url.encode(new Uint8Array(0))).toBe('');
    expect(base64url.decode('')).toEqual(new Uint8Array(0));
  });

  it('refuses text that is not base64', () => {
    expect(() => base64url.decode('Z')).toThrow();
    expect(() => base64url.decode('Zg*')).toThrow();
    expect(() => base64url.decode('Z=g')).toThrow();
  });
});
