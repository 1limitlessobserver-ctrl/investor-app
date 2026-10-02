// Sharing files from the app, such as a statement PDF or a CSV export: the system share sheet
// where the browser can share files, and a download of each file everywhere else, or when the
// sheet fails for any reason other than the investor closing it or a sheet already being open.

import type { ShareAdapter } from '../types';

/** How long a download's object URL is kept; Safari can fail a download revoked at once. */
const REVOKE_AFTER_MS = 10_000;

export function createWebShare(): ShareAdapter {
  return {
    async files(files, title) {
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, title });
          return 'shared';
        } catch (error) {
          // Closing the sheet is an AbortError, and a sheet already open (a second tap) an
          // InvalidStateError; any other failure falls back to a download.
          const cancelled = ['AbortError', 'InvalidStateError'];
          if (error instanceof DOMException && cancelled.includes(error.name)) return 'cancelled';
        }
      }
      files.forEach(download);
      return 'downloaded';
    },
  };
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
