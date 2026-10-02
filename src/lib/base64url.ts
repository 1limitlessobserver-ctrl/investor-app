// Base64url (RFC 4648 §5), the encoding WebAuthn and Web Push use for challenges, credential ids
// and keys: the URL-safe alphabet ("-" and "_") without "=" padding. Decoding is lenient about
// form: it also takes the standard alphabet ("+" and "/") and padded text.

export const base64url = {
  encode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  },

  /** Throws when the text is not base64 in either alphabet. */
  decode(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  },
};
