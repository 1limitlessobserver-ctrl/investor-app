import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebShare } from './share';

describe('web share', () => {
  const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
  it('uses the share sheet when files can be shared', async () => {
    Object.assign(navigator, { canShare: () => true, share: vi.fn(async () => {}) });
    expect(await createWebShare().files([file], 'Statement')).toBe('shared');
    expect(
      (navigator.share as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0],
    ).toEqual({ files: [file], title: 'Statement' });
  });
  it('reports a cancelled share', async () => {
    Object.assign(navigator, {
      canShare: () => true,
      share: vi.fn(() => Promise.reject(new DOMException('cancel', 'AbortError'))),
    });
    expect(await createWebShare().files([file], 'Statement')).toBe('cancelled');
  });
  it('downloads when sharing files is unsupported', async () => {
    Object.assign(navigator, { canShare: undefined, share: undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    expect(await createWebShare().files([file], 'Statement')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });
});

describe('web share: the download fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const pdf = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });
  const csv = new File(['date,amount'], 'statement.csv', { type: 'text/csv' });

  /** Records each download: the anchor's URL and file name at the moment it is clicked. */
  function downloads() {
    const seen: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ href: this.href, download: this.download });
    });
    let made = 0;
    URL.createObjectURL = vi.fn(() => `blob:file-${++made}`);
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    return { seen, revoke };
  }

  it('downloads instead when the share sheet fails for another reason than a cancel', async () => {
    const share = vi.fn(() => Promise.reject(new DOMException('Denied.', 'NotAllowedError')));
    Object.assign(navigator, { canShare: () => true, share });
    const { seen } = downloads();
    expect(await createWebShare().files([pdf], 'Statement')).toBe('downloaded');
    expect(share).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ href: 'blob:file-1', download: 'statement.pdf' }]);
  });

  it('downloads nothing when the share is cancelled', async () => {
    const share = vi.fn(() => Promise.reject(new DOMException('Cancelled.', 'AbortError')));
    Object.assign(navigator, { canShare: () => true, share });
    const { seen } = downloads();
    expect(await createWebShare().files([pdf], 'Statement')).toBe('cancelled');
    expect(seen).toEqual([]);
  });

  it('downloads each file under its own name, and revokes its URL afterwards', async () => {
    vi.useFakeTimers();
    const canShare = vi.fn(() => false);
    const share = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { canShare, share });
    const { seen, revoke } = downloads();
    expect(await createWebShare().files([pdf, csv], 'Statement')).toBe('downloaded');
    expect(canShare).toHaveBeenCalledWith({ files: [pdf, csv] });
    expect(share).not.toHaveBeenCalled();
    expect(seen).toEqual([
      { href: 'blob:file-1', download: 'statement.pdf' },
      { href: 'blob:file-2', download: 'statement.csv' },
    ]);
    expect(document.querySelector('a')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke.mock.calls).toEqual([['blob:file-1'], ['blob:file-2']]);
  });
});
