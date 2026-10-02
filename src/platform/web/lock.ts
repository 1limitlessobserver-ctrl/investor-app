// The device lock for the web: the operating system's own prompt through WebAuthn (Face ID,
// Touch ID, Windows Hello, Android biometrics), or a six-digit passcode where there is no
// platform authenticator. It gates the app's screens on this device; the platform session stays
// the real security. No server takes part: each assertion is verified here, with WebCrypto,
// against the public key kept at enrolment. Both enrolments live in secure storage, one at a time:
// `lock:webauthn` holds the credential id and public key, `lock:passcode` a PBKDF2 hash, its salt
// and the count of wrong attempts.

import { base64url } from '../../lib/base64url';
import type { LockAdapter, SecureStorage } from '../types';

const WEBAUTHN = 'lock:webauthn';
const PASSCODE = 'lock:passcode';
const MAX_ATTEMPTS = 5;
const PBKDF2_ITERATIONS = 310_000;
const PROMPT_TIMEOUT_MS = 60_000;
const ES256 = -7;
const RS256 = -257;
/** authenticatorData flags: the user was present (UP), and was verified (UV). */
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const CANNOT_ENROL = 'This browser cannot enrol a device lock.';

type Alg = -7 | -257;
type Bytes = Uint8Array<ArrayBuffer>;

/** `lock:webauthn`, stored with both byte strings in base64url. */
interface CredentialRecord {
  credentialId: Bytes;
  publicKeySpki: Bytes;
  alg: Alg;
}

/** `lock:passcode`, stored with both byte strings in base64url. */
interface PasscodeRecord {
  salt: Bytes;
  hash: Bytes;
  attempts: number;
}

export function createLock(opts: {
  storage: SecureStorage;
  rpId?: string | undefined;
  origin?: string | undefined;
  credentials?: CredentialsContainer | undefined;
}): LockAdapter {
  const { storage } = opts;
  const rpId = opts.rpId ?? location.hostname;
  const origin = opts.origin ?? location.origin;
  // Absent outside a secure context, and in test environments.
  const credentials: CredentialsContainer | undefined = opts.credentials ?? navigator.credentials;

  // Within this page, changes to the stored enrolments run one at a time, so that two checks of
  // the passcode made together each count, and none writes back a count over a newer passcode.
  // Another tab has its own queue. The queue goes on after a change that failed, and only the
  // caller sees the failure: a change that nobody waits for still rejects unhandled.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const settled = queue.then(task).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    queue = settled;
    return settled.then((outcome) => {
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    });
  }

  /**
   * The record kept under `entry`, or null. A record that cannot be read is removed, so the lock
   * fails closed and the next enrolment starts clean.
   */
  async function read<T>(entry: string, parse: (stored: string) => T | null): Promise<T | null> {
    const stored = await storage.get(entry);
    if (stored === null) return null;
    const record = parse(stored);
    if (record === null) await storage.remove(entry);
    return record;
  }

  const readCredential = () => read(WEBAUTHN, credentialFrom);
  const readPasscode = () => read(PASSCODE, passcodeFrom);

  async function writePasscode(passcode: PasscodeRecord): Promise<void> {
    const { salt, hash, attempts } = passcode;
    await storage.set(
      PASSCODE,
      JSON.stringify({ salt: base64url.encode(salt), hash: base64url.encode(hash), attempts }),
    );
  }

  return {
    async available() {
      if (!credentials) return 'passcode';
      try {
        const browser = globalThis as {
          PublicKeyCredential?: typeof PublicKeyCredential;
          AuthenticatorAttestationResponse?: typeof AuthenticatorAttestationResponse;
        };
        // Enrolment keeps the key getPublicKey() hands over, which iOS 15 and older Chromium lack.
        const prototype = browser.AuthenticatorAttestationResponse?.prototype;
        if (typeof prototype?.getPublicKey !== 'function') return 'passcode';
        const ready =
          await browser.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable();
        return ready === true ? 'webauthn' : 'passcode';
      } catch {
        return 'passcode';
      }
    },

    async enrolled() {
      // Which record exists, readable or not: the checks fail closed on one they cannot read.
      if ((await storage.get(WEBAUTHN)) !== null) return 'webauthn';
      if ((await storage.get(PASSCODE)) !== null) return 'passcode';
      return null;
    },

    async enrollWebAuthn(user) {
      if (!credentials) throw new Error(CANNOT_ENROL);
      const created = await credentials.create({
        publicKey: {
          rp: { id: rpId, name: document.title },
          user: { id: randomBytes(32), name: user.email, displayName: user.email },
          challenge: randomBytes(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: ES256 },
            { type: 'public-key', alg: RS256 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          attestation: 'none',
          timeout: PROMPT_TIMEOUT_MS,
        },
      });
      const credential = enrolmentOf(created);
      if (!credential) throw new Error(CANNOT_ENROL);
      await exclusive(async () => {
        await storage.set(
          WEBAUTHN,
          JSON.stringify({
            credentialId: base64url.encode(credential.credentialId),
            publicKeySpki: base64url.encode(credential.publicKeySpki),
            alg: credential.alg,
          }),
        );
        await storage.remove(PASSCODE);
      });
    },

    async enrollPasscode(code) {
      if (!/^\d{6}$/.test(code)) throw new Error('The passcode must be six digits.');
      const salt = randomBytes(16);
      const hash = await derive(code, salt);
      await exclusive(async () => {
        await writePasscode({ salt, hash, attempts: 0 });
        await storage.remove(WEBAUTHN);
      });
    },

    async verify() {
      try {
        const credential = await exclusive(readCredential);
        if (!credentials || !credential) return false;
        const challenge = randomBytes(32);
        const assertion = await credentials.get({
          publicKey: {
            challenge,
            allowCredentials: [{ id: credential.credentialId, type: 'public-key' }],
            userVerification: 'required',
            rpId,
            timeout: PROMPT_TIMEOUT_MS,
          },
        });
        if (!assertion) return false;
        const response = (assertion as PublicKeyCredential)
          .response as AuthenticatorAssertionResponse;
        return await verifyAssertion({
          publicKeySpki: credential.publicKeySpki,
          alg: credential.alg,
          authenticatorData: new Uint8Array(response.authenticatorData),
          clientDataJSON: new Uint8Array(response.clientDataJSON),
          signature: new Uint8Array(response.signature),
          expectedChallenge: challenge,
          expectedOrigin: origin,
          rpId,
        });
      } catch {
        // A cancelled or timed-out prompt (NotAllowedError) lands here too.
        return false;
      }
    },

    verifyPasscode(code) {
      return exclusive(async () => {
        // As in enrolled(), a credential record outranks the passcode: one left beside it by a
        // swap whose removal failed must not unlock, so remove it, checking nothing.
        if ((await storage.get(WEBAUTHN)) !== null) {
          await storage.remove(PASSCODE);
          return { ok: false, attemptsLeft: 0 };
        }
        const passcode = await readPasscode();
        if (!passcode) return { ok: false, attemptsLeft: 0 };
        if (passcode.attempts >= MAX_ATTEMPTS) {
          // A fifth wrong attempt that could not wipe the passcode: wipe it now, checking nothing.
          await storage.remove(PASSCODE);
          return { ok: false, attemptsLeft: 0 };
        }
        // Count the attempt before checking it: an attempt that cannot be counted is not checked.
        const attempts = passcode.attempts + 1;
        await writePasscode({ ...passcode, attempts });
        if (sameBytes(await derive(code, passcode.salt), passcode.hash)) {
          await writePasscode({ ...passcode, attempts: 0 });
          return { ok: true, attemptsLeft: MAX_ATTEMPTS };
        }
        if (attempts >= MAX_ATTEMPTS) {
          await storage.remove(PASSCODE);
          return { ok: false, attemptsLeft: 0 };
        }
        return { ok: false, attemptsLeft: MAX_ATTEMPTS - attempts };
      });
    },

    clear() {
      return exclusive(async () => {
        await storage.remove(WEBAUTHN);
        await storage.remove(PASSCODE);
      });
    },
  };
}

/**
 * True only for an assertion that this origin's page asked for (`webauthn.get`, the challenge, the
 * origin, not from a cross-origin frame), from an authenticator for `rpId` that saw the user and
 * verified them, signed by the key enrolled. Malformed input answers false; it never throws.
 */
export async function verifyAssertion(input: {
  publicKeySpki: Uint8Array;
  alg: -7 | -257;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  expectedChallenge: Uint8Array;
  expectedOrigin: string;
  rpId: string;
}): Promise<boolean> {
  try {
    const clientData: unknown = JSON.parse(new TextDecoder().decode(input.clientDataJSON));
    if (typeof clientData !== 'object' || clientData === null) return false;
    const { type, challenge, origin, crossOrigin } = clientData as Record<string, unknown>;
    if (type !== 'webauthn.get') return false;
    if (challenge !== base64url.encode(input.expectedChallenge)) return false;
    if (origin !== input.expectedOrigin) return false;
    if (crossOrigin === true) return false;

    const authenticatorData = input.authenticatorData.slice();
    if (authenticatorData.length < 37) return false;
    const rpIdHash = await sha256(new TextEncoder().encode(input.rpId));
    if (!sameBytes(authenticatorData.subarray(0, 32), rpIdHash)) return false;
    const flags = authenticatorData[32] ?? 0;
    if ((flags & USER_PRESENT) === 0 || (flags & USER_VERIFIED) === 0) return false;

    const signed = new Uint8Array([...authenticatorData, ...(await sha256(input.clientDataJSON))]);
    if (input.alg === ES256) {
      const signature = rawSignature(input.signature);
      if (!signature) return false;
      const key = await crypto.subtle.importKey(
        'spki',
        input.publicKeySpki.slice(),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed);
    }
    if (input.alg === RS256) {
      const key = await crypto.subtle.importKey(
        'spki',
        input.publicKeySpki.slice(),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, input.signature.slice(), signed);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * An ES256 signature as WebCrypto verifies it: r and s, 32 bytes each. The authenticator sends DER,
 * SEQUENCE { INTEGER r, INTEGER s }, where each integer drops its leading zero bytes and gains a
 * 0x00 before a first byte of 0x80 or more. Null when the bytes are not exactly that: another tag
 * or length, bytes left over, or an integer longer than 32 bytes but for that one sign byte.
 */
function rawSignature(der: Uint8Array): Bytes | null {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const raw = new Uint8Array(64);
  let at = 2;
  for (const offset of [0, 32]) {
    const length = der[at + 1];
    if (der[at] !== 0x02 || length === undefined || at + 2 + length > der.length) return null;
    let value = der.subarray(at + 2, at + 2 + length);
    if (value.length === 33 && value[0] === 0 && (value[1] ?? 0) >= 0x80) value = value.subarray(1);
    if (value.length > 32) return null;
    raw.set(value, offset + 32 - value.length);
    at += 2 + length;
  }
  return at === der.length ? raw : null;
}

/** The credential `create()` answered, or null when it gives no public key this lock can use. */
function enrolmentOf(created: Credential | null): CredentialRecord | null {
  const { rawId, response } = (created ?? {}) as Partial<PublicKeyCredential>;
  const attestation = response as Partial<AuthenticatorAttestationResponse> | undefined;
  const spki = attestation?.getPublicKey?.();
  const alg = attestation?.getPublicKeyAlgorithm?.();
  if (!rawId || !spki || (alg !== ES256 && alg !== RS256)) return null;
  return { credentialId: new Uint8Array(rawId), publicKeySpki: new Uint8Array(spki), alg };
}

/** `lock:webauthn` read back: a credential id and public key (neither empty) and ES256 or RS256. */
function credentialFrom(stored: string): CredentialRecord | null {
  try {
    const { credentialId, publicKeySpki, alg } = JSON.parse(stored) as Record<string, unknown>;
    if (typeof credentialId !== 'string' || typeof publicKeySpki !== 'string') return null;
    if (alg !== ES256 && alg !== RS256) return null;
    const record: CredentialRecord = {
      credentialId: base64url.decode(credentialId),
      publicKeySpki: base64url.decode(publicKeySpki),
      alg,
    };
    return record.credentialId.length > 0 && record.publicKeySpki.length > 0 ? record : null;
  } catch {
    return null;
  }
}

/** `lock:passcode` read back: a 16-byte salt, a 32-byte hash and 0 to 5 wrong attempts. */
function passcodeFrom(stored: string): PasscodeRecord | null {
  try {
    const { salt, hash, attempts } = JSON.parse(stored) as Record<string, unknown>;
    if (typeof salt !== 'string' || typeof hash !== 'string') return null;
    if (typeof attempts !== 'number' || !Number.isInteger(attempts)) return null;
    if (attempts < 0 || attempts > MAX_ATTEMPTS) return null;
    const record = { salt: base64url.decode(salt), hash: base64url.decode(hash), attempts };
    return record.salt.length === 16 && record.hash.length === 32 ? record : null;
  } catch {
    return null;
  }
}

/** PBKDF2-SHA-256 over the passcode: 310 000 iterations, 32 bytes. */
async function derive(code: string, salt: Bytes): Promise<Bytes> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256(bytes: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
}

/** Compares in time that depends on the length only, never on where the bytes differ. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}
