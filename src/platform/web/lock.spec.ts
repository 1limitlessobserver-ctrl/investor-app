import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLock, verifyAssertion } from './lock';
import { createSecureStorage, type KvStore } from './storage';
import { base64url } from '../../lib/base64url';
import { memoryKvStore } from '../../test/memoryKvStore';
import type { SecureStorage } from '../types';

function memoryStore(): KvStore {
  const raw = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(raw.get(k)),
    set: (k, v) => {
      raw.set(k, v);
      return Promise.resolve();
    },
    del: (k) => {
      raw.delete(k);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...raw.keys()]),
    update: <T>(k: string, updater: (old: T | undefined) => T) => {
      const next = updater(raw.get(k) as T | undefined);
      raw.set(k, next);
      return Promise.resolve(next);
    },
  };
}
const storage = () => createSecureStorage({ db: memoryStore() });

function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0]! & 0x80) v = new Uint8Array([0, ...v]);
    return new Uint8Array([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32)),
    s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

async function fabricate(opts: {
  alg: -7 | -257;
  challenge: Uint8Array;
  origin: string;
  rpId: string;
  uv: boolean;
}) {
  const keyPair =
    opts.alg === -7
      ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
          'sign',
          'verify',
        ])
      : await crypto.subtle.generateKey(
          {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
          true,
          ['sign', 'verify'],
        );
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.rpId)),
  );
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash);
  authenticatorData[32] = opts.uv ? 0x05 : 0x01;
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: base64url.encode(opts.challenge),
      origin: opts.origin,
    }),
  );
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = new Uint8Array([...authenticatorData, ...clientHash]);
  let signature = new Uint8Array(
    await crypto.subtle.sign(
      opts.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.privateKey,
      signed,
    ),
  );
  if (opts.alg === -7) signature = rawToDer(signature);
  return { publicKeySpki, alg: opts.alg, authenticatorData, clientDataJSON, signature };
}

describe('verifyAssertion', () => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  it('accepts a valid ES256 and RS256 assertion', async () => {
    for (const alg of [-7, -257] as const) {
      const a = await fabricate({
        alg,
        challenge,
        origin: 'https://app.example',
        rpId: 'app.example',
        uv: true,
      });
      expect(
        await verifyAssertion({
          ...a,
          expectedChallenge: challenge,
          expectedOrigin: 'https://app.example',
          rpId: 'app.example',
        }),
        String(alg),
      ).toBe(true);
    }
  });
  it('rejects a wrong challenge, origin, rpId, missing user verification or a bad signature', async () => {
    const a = await fabricate({
      alg: -7,
      challenge,
      origin: 'https://app.example',
      rpId: 'app.example',
      uv: true,
    });
    const ok = {
      ...a,
      expectedChallenge: challenge,
      expectedOrigin: 'https://app.example',
      rpId: 'app.example',
    };
    expect(
      await verifyAssertion({
        ...ok,
        expectedChallenge: crypto.getRandomValues(new Uint8Array(32)),
      }),
    ).toBe(false);
    expect(await verifyAssertion({ ...ok, expectedOrigin: 'https://evil.example' })).toBe(false);
    expect(await verifyAssertion({ ...ok, rpId: 'other.example' })).toBe(false);
    const noUv = await fabricate({
      alg: -7,
      challenge,
      origin: 'https://app.example',
      rpId: 'app.example',
      uv: false,
    });
    expect(
      await verifyAssertion({
        ...noUv,
        expectedChallenge: challenge,
        expectedOrigin: 'https://app.example',
        rpId: 'app.example',
      }),
    ).toBe(false);
    const tampered = new Uint8Array(a.signature);
    tampered[tampered.length - 1]! ^= 0xff;
    expect(await verifyAssertion({ ...ok, signature: tampered })).toBe(false);
  });
});

describe('passcode lock', () => {
  it('enrols, verifies, counts attempts and clears after five failures', async () => {
    const lock = createLock({ storage: storage(), credentials: undefined });
    expect(await lock.available()).toBe('passcode');
    expect(await lock.enrolled()).toBeNull();
    await lock.enrollPasscode('246810');
    expect(await lock.enrolled()).toBe('passcode');
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: true, attemptsLeft: 5 });
    for (let i = 4; i >= 1; i--)
      expect(await lock.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: i });
    expect(await lock.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: 0 });
    expect(await lock.enrolled()).toBeNull(); // wiped after the fifth failure
  });
  it('refuses a passcode that is not six digits', async () => {
    const lock = createLock({ storage: storage(), credentials: undefined });
    await expect(lock.enrollPasscode('12')).rejects.toThrow('six digits');
  });
});

describe('webauthn lock', () => {
  it('reports webauthn when a platform authenticator exists and verifies through credentials.get', async () => {
    const challengeSeen: Uint8Array[] = [];
    const assertion = await fabricate({
      alg: -7,
      challenge: new Uint8Array(32),
      origin: 'http://localhost:3000',
      rpId: 'localhost',
      uv: true,
    });
    const credentials = {
      create: vi.fn(() =>
        Promise.resolve({
          rawId: new Uint8Array([1, 2, 3]).buffer,
          response: {
            getPublicKey: () => assertion.publicKeySpki.buffer,
            getPublicKeyAlgorithm: () => -7,
          },
        }),
      ),
      get: vi.fn((o: { publicKey: { challenge: Uint8Array } }) => {
        challengeSeen.push(o.publicKey.challenge);
        return Promise.resolve(null);
      }),
    } as unknown as CredentialsContainer;
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    };
    const lock = createLock({
      storage: storage(),
      credentials,
      rpId: 'localhost',
      origin: 'http://localhost:3000',
    });
    expect(await lock.available()).toBe('webauthn');
    await lock.enrollWebAuthn({ id: 'u1', email: 'ada@example.com' });
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await lock.verify()).toBe(false); // the stub returned no assertion
    expect(challengeSeen[0]!.length).toBe(32);
    const createArg = (
      credentials.create as unknown as {
        mock: {
          calls: [
            [
              {
                publicKey: {
                  authenticatorSelection: unknown;
                  user: { name: string; id: Uint8Array };
                };
              },
            ],
          ];
        };
      }
    ).mock.calls[0][0].publicKey;
    expect(createArg.authenticatorSelection).toEqual({
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    });
    expect(createArg.user.name).toBe('ada@example.com');
    expect(createArg.user.id.length).toBe(32); // a random handle, never the email
  });
});

/** Storage over the shared memory store, for the describes below; storage() serves the plan's. */
const secureStorage = () => createSecureStorage({ db: memoryKvStore() });

/** Signs as a platform authenticator would, with ES256, over client data and flags we choose. */
async function signAssertion(
  keyPair: CryptoKeyPair,
  opts: { clientData: object; rpId: string; flags: number },
) {
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.rpId))),
  );
  authenticatorData[32] = opts.flags;
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(opts.clientData));
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new Uint8Array([...authenticatorData, ...clientHash]),
  );
  return { authenticatorData, clientDataJSON, signature: rawToDer(new Uint8Array(raw)) };
}

const es256 = () =>
  crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spkiOf = async (keyPair: CryptoKeyPair) =>
  new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));

describe('verifyAssertion: every check, and malformed input', () => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const expected = {
    expectedChallenge: challenge,
    expectedOrigin: 'https://app.example',
    rpId: 'app.example',
  };
  const clientData = (extra: object = {}) => ({
    type: 'webauthn.get',
    challenge: base64url.encode(challenge),
    origin: 'https://app.example',
    ...extra,
  });
  async function check(opts: { clientData?: object; flags?: number }) {
    const keyPair = await es256();
    const signed = await signAssertion(keyPair, {
      clientData: opts.clientData ?? clientData(),
      rpId: 'app.example',
      flags: opts.flags ?? 0x05,
    });
    return verifyAssertion({
      publicKeySpki: await spkiOf(keyPair),
      alg: -7,
      ...signed,
      ...expected,
    });
  }

  it('refuses an assertion made in a cross-origin frame', async () => {
    expect(await check({ clientData: clientData({ crossOrigin: false }) })).toBe(true);
    expect(await check({ clientData: clientData({ crossOrigin: true }) })).toBe(false);
  });

  it('refuses a create ceremony, and either flag without the other', async () => {
    expect(await check({})).toBe(true);
    expect(await check({ clientData: clientData({ type: 'webauthn.create' }) })).toBe(false);
    expect(await check({ flags: 0x04 })).toBe(false); // verified, but no user presence
    expect(await check({ flags: 0x01 })).toBe(false); // present, but not verified
  });

  it('answers false, never throwing, for malformed input', async () => {
    const keyPair = await es256();
    const signed = await signAssertion(keyPair, {
      clientData: clientData(),
      rpId: 'app.example',
      flags: 0x05,
    });
    const valid = {
      publicKeySpki: await spkiOf(keyPair),
      alg: -7 as const,
      ...signed,
      ...expected,
    };
    expect(await verifyAssertion(valid)).toBe(true);
    const text = (s: string) => new TextEncoder().encode(s);
    const cases: [string, Partial<Parameters<typeof verifyAssertion>[0]>][] = [
      ['client data that is not JSON', { clientDataJSON: text('{"type":') }],
      ['client data that is null', { clientDataJSON: text('null') }],
      ['client data that is a string', { clientDataJSON: text('"webauthn.get"') }],
      [
        'authenticator data under 37 bytes',
        { authenticatorData: signed.authenticatorData.slice(0, 36) },
      ],
      ['an empty signature', { signature: new Uint8Array(0) }],
      ['a raw r||s signature instead of DER', { signature: new Uint8Array(64).fill(1) }],
      ['a DER signature cut short', { signature: signed.signature.slice(0, -1) }],
      ['a public key that is not SPKI', { publicKeySpki: new Uint8Array([1, 2, 3]) }],
      ['RS256 claimed for an EC key', { alg: -257 }],
      ['an algorithm it does not know', { alg: -8 as unknown as -7 }],
    ];
    for (const [name, change] of cases) {
      await expect(verifyAssertion({ ...valid, ...change }), name).resolves.toBe(false);
    }
  });

  it('reads an ES256 r or s that is short, or carries a sign byte, as 32 bytes', async () => {
    // DER drops the leading zero bytes of r and s and puts 0x00 before a first byte of 0x80 or
    // more; WebCrypto wants each as exactly 32 bytes. Sign until both forms have come up.
    const keyPair = await es256();
    const publicKeySpki = await spkiOf(keyPair);
    const seen = { short: false, signByte: false };
    for (let i = 0; i < 20_000 && !(seen.short && seen.signByte); i++) {
      const fresh = crypto.getRandomValues(new Uint8Array(32));
      const signed = await signAssertion(keyPair, {
        clientData: clientData({ challenge: base64url.encode(fresh) }),
        rpId: 'app.example',
        flags: 0x05,
      });
      const rLength = signed.signature[3]!;
      const sLength = signed.signature[5 + rLength]!;
      const form =
        rLength < 32 || sLength < 32
          ? 'short'
          : rLength === 33 || sLength === 33
            ? 'signByte'
            : null;
      if (form === null || seen[form]) continue;
      seen[form] = true;
      const input = {
        publicKeySpki,
        alg: -7 as const,
        ...signed,
        ...expected,
        expectedChallenge: fresh,
      };
      expect(await verifyAssertion(input), form).toBe(true);
    }
    expect(seen).toEqual({ short: true, signByte: true });
  });
});

describe('passcode lock: what it keeps and how it counts', () => {
  it('keeps a PBKDF2-SHA-256 hash under a random 16-byte salt, never the passcode', async () => {
    const secure = secureStorage();
    const lock = createLock({ storage: secure, credentials: undefined });
    await lock.enrollPasscode('246810');
    const stored = (await secure.get('lock:passcode'))!;
    expect(stored).not.toContain('246810');
    const entry = JSON.parse(stored) as { salt: string; hash: string; attempts: number };
    expect(entry.attempts).toBe(0);
    const salt = base64url.decode(entry.salt);
    expect(salt).toHaveLength(16);
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('246810'),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const hash = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
      material,
      256,
    );
    expect(entry.hash).toBe(base64url.encode(new Uint8Array(hash)));
    await lock.enrollPasscode('246810');
    const again = JSON.parse((await secure.get('lock:passcode'))!) as { salt: string };
    expect(again.salt).not.toBe(entry.salt);
  });

  it('keeps the count of wrong attempts across a reload, and a success resets it', async () => {
    const db = memoryKvStore();
    const reload = () =>
      createLock({ storage: createSecureStorage({ db }), credentials: undefined });
    const first = reload();
    await first.enrollPasscode('246810');
    expect(await first.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: 4 });
    expect(await first.verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: 3 });
    expect(await reload().verifyPasscode('111111')).toEqual({ ok: false, attemptsLeft: 2 });
    expect(await reload().verifyPasscode('246810')).toEqual({ ok: true, attemptsLeft: 5 });
    expect(await reload().verifyPasscode('000000')).toEqual({ ok: false, attemptsLeft: 4 });
  });

  it('counts wrong attempts made at the same time once each', async () => {
    const lock = createLock({ storage: secureStorage(), credentials: undefined });
    await lock.enrollPasscode('246810');
    const answers = await Promise.all([1, 2, 3].map(() => lock.verifyPasscode('000000')));
    expect(answers.map((answer) => answer.attemptsLeft)).toEqual([4, 3, 2]);
  });

  it('answers attemptsLeft 0 when no passcode is enrolled', async () => {
    const lock = createLock({ storage: secureStorage(), credentials: undefined });
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: false, attemptsLeft: 0 });
  });

  it('checks no passcode whose attempt cannot be counted, so nothing answers ok', async () => {
    const secure = secureStorage();
    let full = false;
    const flaky: SecureStorage = {
      ...secure,
      set: (key, value) => (full ? Promise.reject(new Error('disk full')) : secure.set(key, value)),
    };
    const lock = createLock({ storage: flaky, credentials: undefined });
    await lock.enrollPasscode('246810');
    full = true;
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    try {
      for (let i = 0; i < 12; i++) {
        await expect(lock.verifyPasscode('000000')).rejects.toThrow('disk full');
      }
      await expect(lock.verifyPasscode('246810')).rejects.toThrow('disk full');
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
  });

  it('stays locked, without checking, when the fifth wrong attempt could not wipe it', async () => {
    const secure = secureStorage();
    let stuck = false;
    const flaky: SecureStorage = {
      ...secure,
      remove: (key) => (stuck ? Promise.reject(new Error('disk error')) : secure.remove(key)),
    };
    const lock = createLock({ storage: flaky, credentials: undefined });
    await lock.enrollPasscode('246810');
    for (let i = 0; i < 4; i++) await lock.verifyPasscode('000000');
    stuck = true;
    await expect(lock.verifyPasscode('000000')).rejects.toThrow('disk error');
    stuck = false;
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    try {
      expect(await lock.verifyPasscode('246810')).toEqual({ ok: false, attemptsLeft: 0 });
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
    expect(await lock.enrolled()).toBeNull();
  });

  it('refuses anything but exactly six digits, and enrols nothing', async () => {
    const lock = createLock({ storage: secureStorage(), credentials: undefined });
    for (const code of [
      '',
      '12345',
      '1234567',
      '12345a',
      ' 123456',
      '123456\n',
      '１２３４５６',
      '٢٤٦٨١٠',
    ]) {
      await expect(lock.enrollPasscode(code), JSON.stringify(code)).rejects.toThrow(
        'The passcode must be six digits.',
      );
    }
    expect(await lock.enrolled()).toBeNull();
  });
});

type GetOptions = { publicKey: PublicKeyCredentialRequestOptions & { challenge: Uint8Array } };
type CreateOptions = {
  publicKey: PublicKeyCredentialCreationOptions & {
    challenge: Uint8Array;
    user: { id: Uint8Array };
  };
};

/** A platform authenticator: create() hands over an ES256 key; get() signs for `origin`. */
async function fakeAuthenticator(origin = 'http://localhost:3000') {
  const keyPair = await es256();
  const publicKeySpki = await spkiOf(keyPair);
  const create = vi.fn<(options: CreateOptions) => Promise<unknown>>(() =>
    Promise.resolve({
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: { getPublicKey: () => publicKeySpki.buffer, getPublicKeyAlgorithm: () => -7 },
    }),
  );
  const get = vi.fn(async (options: GetOptions) => {
    const clientData = {
      type: 'webauthn.get',
      challenge: base64url.encode(options.publicKey.challenge),
      origin,
    };
    const signed = await signAssertion(keyPair, { clientData, rpId: 'localhost', flags: 0x05 });
    return {
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: {
        authenticatorData: signed.authenticatorData.slice().buffer,
        clientDataJSON: signed.clientDataJSON.slice().buffer,
        signature: signed.signature.slice().buffer,
      },
    };
  });
  return {
    create,
    get,
    publicKeySpki,
    credentials: { create, get } as unknown as CredentialsContainer,
  };
}

const lockOver = (credentials: CredentialsContainer | undefined, secure = secureStorage()) =>
  createLock({ storage: secure, credentials, rpId: 'localhost', origin: 'http://localhost:3000' });
const ada = { id: 'u1', email: 'ada@example.com' };

describe('webauthn lock: availability, enrolment and verification', () => {
  const title = document.title;
  afterEach(() => {
    document.title = title;
    vi.unstubAllGlobals();
  });
  const platformAuthenticator = (answer: () => Promise<boolean>) =>
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: answer });

  it('reports webauthn only with credentials and a platform authenticator', async () => {
    const { credentials } = await fakeAuthenticator();
    platformAuthenticator(() => Promise.resolve(true));
    expect(await lockOver(credentials).available()).toBe('webauthn');
    expect(await lockOver(undefined).available()).toBe('passcode');
    platformAuthenticator(() => Promise.resolve(false));
    expect(await lockOver(credentials).available()).toBe('passcode');
    platformAuthenticator(() => Promise.reject(new Error('not now')));
    expect(await lockOver(credentials).available()).toBe('passcode');
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await lockOver(credentials).available()).toBe('passcode');
  });

  it('enrols a platform credential and keeps its id and public key', async () => {
    document.title = 'Northwind Invest';
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    const lock = lockOver(auth.credentials, secure);
    await lock.enrollWebAuthn(ada);
    const { publicKey } = auth.create.mock.calls[0]![0];
    expect(publicKey.rp).toEqual({ id: 'localhost', name: 'Northwind Invest' });
    expect(publicKey.user.displayName).toBe('ada@example.com');
    expect(publicKey.challenge).toHaveLength(32);
    expect(publicKey.pubKeyCredParams).toEqual([
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ]);
    expect(publicKey.attestation).toBe('none');
    expect(publicKey.timeout).toBe(60_000);
    expect(JSON.parse((await secure.get('lock:webauthn'))!)).toEqual({
      credentialId: 'AQID',
      publicKeySpki: base64url.encode(auth.publicKeySpki),
      alg: -7,
    });
    await lock.enrollWebAuthn(ada);
    const second = auth.create.mock.calls[1]![0].publicKey;
    expect(base64url.encode(second.user.id)).not.toBe(base64url.encode(publicKey.user.id));
    expect(base64url.encode(second.challenge)).not.toBe(base64url.encode(publicKey.challenge));
  });

  it('cannot enrol where the browser gives no usable public key, and enrols nothing', async () => {
    const { publicKeySpki } = await fakeAuthenticator();
    const responses = [
      {},
      { getPublicKey: () => null, getPublicKeyAlgorithm: () => -7 },
      { getPublicKey: () => publicKeySpki.buffer, getPublicKeyAlgorithm: () => -8 },
    ];
    for (const response of responses) {
      const create = vi.fn(() => Promise.resolve({ rawId: new Uint8Array([1]).buffer, response }));
      const lock = lockOver({ create, get: vi.fn() } as unknown as CredentialsContainer);
      await expect(lock.enrollWebAuthn(ada)).rejects.toThrow(
        'This browser cannot enrol a device lock.',
      );
      expect(await lock.enrolled()).toBeNull();
    }
    await expect(lockOver(undefined).enrollWebAuthn(ada)).rejects.toThrow(
      'This browser cannot enrol a device lock.',
    );
  });

  it('passes on a cancelled enrolment as the browser reports it', async () => {
    const auth = await fakeAuthenticator();
    auth.create.mockRejectedValueOnce(new DOMException('Not allowed.', 'NotAllowedError'));
    const lock = lockOver(auth.credentials);
    await expect(lock.enrollWebAuthn(ada)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await lock.enrolled()).toBeNull();
  });

  it('verifies an assertion of the enrolled credential, with a fresh challenge', async () => {
    const auth = await fakeAuthenticator();
    const lock = lockOver(auth.credentials);
    await lock.enrollWebAuthn(ada);
    expect(await lock.verify()).toBe(true);
    expect(await lock.verify()).toBe(true);
    const [first, second] = auth.get.mock.calls.map(([options]) => options.publicKey);
    expect(first!.allowCredentials).toEqual([
      { id: new Uint8Array([1, 2, 3]), type: 'public-key' },
    ]);
    expect(first!.userVerification).toBe('required');
    expect(first!.rpId).toBe('localhost');
    expect(first!.timeout).toBe(60_000);
    expect(first!.challenge).toHaveLength(32);
    expect(base64url.encode(second!.challenge)).not.toBe(base64url.encode(first!.challenge));
  });

  it('answers false for a cancelled prompt or an assertion for another origin', async () => {
    const auth = await fakeAuthenticator('https://evil.example');
    const lock = lockOver(auth.credentials);
    await lock.enrollWebAuthn(ada);
    expect(await lock.verify()).toBe(false);
    auth.get.mockRejectedValueOnce(new DOMException('Not allowed.', 'NotAllowedError'));
    expect(await lock.verify()).toBe(false);
  });

  it('answers false with no credential enrolled, without asking the browser', async () => {
    const auth = await fakeAuthenticator();
    expect(await lockOver(auth.credentials).verify()).toBe(false);
    expect(auth.get).not.toHaveBeenCalled();
  });

  it('replaces one method with the other on enrolment, and clear forgets it', async () => {
    const auth = await fakeAuthenticator();
    const lock = lockOver(auth.credentials);
    await lock.enrollPasscode('246810');
    await lock.enrollWebAuthn(ada);
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: false, attemptsLeft: 0 });
    await lock.enrollPasscode('135790');
    expect(await lock.enrolled()).toBe('passcode');
    expect(await lock.verify()).toBe(false);
    await lock.clear();
    expect(await lock.enrolled()).toBeNull();
    await lock.enrollWebAuthn(ada);
    await lock.clear();
    expect(await lock.enrolled()).toBeNull();
  });
});

describe('device lock: a stored record it cannot read', () => {
  const bytes = (length: number) => base64url.encode(new Uint8Array(length).fill(1));
  const passcodeRecord = (fields: object) =>
    JSON.stringify({ salt: bytes(16), hash: bytes(32), attempts: 0, ...fields });
  const credentialRecord = (fields: object) =>
    JSON.stringify({ credentialId: 'AQID', publicKeySpki: bytes(91), alg: -7, ...fields });
  const badPasscodes = [
    'not json',
    'null',
    passcodeRecord({ salt: 1 }),
    passcodeRecord({ salt: bytes(15) }),
    passcodeRecord({ hash: bytes(31) }),
    passcodeRecord({ hash: '***' }),
    passcodeRecord({ attempts: -1 }),
    passcodeRecord({ attempts: 1.5 }),
    passcodeRecord({ attempts: 6 }),
    passcodeRecord({ attempts: '0' }),
  ];
  const badCredentials = [
    'not json',
    '[]',
    credentialRecord({ credentialId: 1 }),
    credentialRecord({ credentialId: '***' }),
    credentialRecord({ credentialId: '' }),
    credentialRecord({ publicKeySpki: '' }),
    credentialRecord({ alg: -8 }),
    credentialRecord({ alg: '-7' }),
  ];

  it('still reports the method whose record is stored', async () => {
    for (const [entry, records, method] of [
      ['lock:passcode', badPasscodes, 'passcode'],
      ['lock:webauthn', badCredentials, 'webauthn'],
    ] as const) {
      for (const record of records) {
        const secure = secureStorage();
        await secure.set(entry, record);
        const lock = createLock({ storage: secure, credentials: undefined });
        expect(await lock.enrolled(), record).toBe(method);
      }
    }
  });

  it('answers attemptsLeft 0 for a passcode record it cannot read, and removes it', async () => {
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    try {
      for (const record of badPasscodes) {
        const secure = secureStorage();
        await secure.set('lock:passcode', record);
        const lock = createLock({ storage: secure, credentials: undefined });
        expect(await lock.verifyPasscode('246810'), record).toEqual({ ok: false, attemptsLeft: 0 });
        expect(await secure.get('lock:passcode'), record).toBeNull();
      }
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
  });

  it('answers false from verify() for a credential it cannot read, and removes it', async () => {
    const auth = await fakeAuthenticator();
    for (const record of badCredentials) {
      const secure = secureStorage();
      await secure.set('lock:webauthn', record);
      expect(await lockOver(auth.credentials, secure).verify(), record).toBe(false);
      expect(await secure.get('lock:webauthn'), record).toBeNull();
    }
    expect(auth.get).not.toHaveBeenCalled();
  });

  it('removes an unreadable credential without touching one enrolled meanwhile', async () => {
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    await secure.set('lock:webauthn', 'not json');
    const lock = lockOver(auth.credentials, secure);
    const [verified] = await Promise.all([lock.verify(), lock.enrollWebAuthn(ada)]);
    expect(verified).toBe(false);
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await lock.verify()).toBe(true);
  });
});

describe('device lock: replacing one method with the other', () => {
  it('keeps the passcode when a WebAuthn enrolment is cancelled or unusable', async () => {
    const auth = await fakeAuthenticator();
    const lock = lockOver(auth.credentials);
    await lock.enrollPasscode('246810');
    auth.create.mockRejectedValueOnce(new DOMException('Not allowed.', 'NotAllowedError'));
    await expect(lock.enrollWebAuthn(ada)).rejects.toMatchObject({ name: 'NotAllowedError' });
    const unusable = [
      null,
      {},
      { rawId: new Uint8Array([1]).buffer, response: {} },
      {
        response: {
          getPublicKey: () => auth.publicKeySpki.buffer,
          getPublicKeyAlgorithm: () => -7,
        },
      },
    ];
    for (const created of unusable) {
      auth.create.mockResolvedValueOnce(created);
      await expect(lock.enrollWebAuthn(ada), JSON.stringify(created)).rejects.toThrow(
        'This browser cannot enrol a device lock.',
      );
    }
    expect(await lock.enrolled()).toBe('passcode');
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: true, attemptsLeft: 5 });
  });

  it('keeps the passcode when the new credential cannot be stored', async () => {
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    const flaky: SecureStorage = {
      ...secure,
      set: (key, value) =>
        key === 'lock:webauthn' ? Promise.reject(new Error('disk full')) : secure.set(key, value),
    };
    const lock = lockOver(auth.credentials, flaky);
    await lock.enrollPasscode('246810');
    await expect(lock.enrollWebAuthn(ada)).rejects.toThrow('disk full');
    expect(await lock.enrolled()).toBe('passcode');
    expect(await lock.verifyPasscode('246810')).toEqual({ ok: true, attemptsLeft: 5 });
  });

  it('keeps the credential when the new passcode is refused or cannot be stored', async () => {
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    let full = false;
    const flaky: SecureStorage = {
      ...secure,
      set: (key, value) => (full ? Promise.reject(new Error('disk full')) : secure.set(key, value)),
    };
    const lock = lockOver(auth.credentials, flaky);
    await lock.enrollWebAuthn(ada);
    await expect(lock.enrollPasscode('12')).rejects.toThrow('six digits');
    full = true;
    await expect(lock.enrollPasscode('246810')).rejects.toThrow('disk full');
    full = false;
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await lock.verify()).toBe(true);
  });

  it('never keeps both records once a swap is done', async () => {
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    const lock = lockOver(auth.credentials, secure);
    const stored = async () => [
      (await secure.get('lock:webauthn')) !== null,
      (await secure.get('lock:passcode')) !== null,
    ];
    await lock.enrollPasscode('246810');
    expect(await stored()).toEqual([false, true]);
    await lock.enrollWebAuthn(ada);
    expect(await stored()).toEqual([true, false]);
    await lock.enrollPasscode('135790');
    expect(await stored()).toEqual([false, true]);
  });
});

/**
 * Holds back the PBKDF2 derivation under `salt` (a passcode check under way) until release();
 * `reached` resolves once it is held, `othersDerived` once any other derivation is done.
 */
function holdDerivation(salt: string) {
  const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let derived!: () => void;
  const othersDerived = new Promise<void>((resolve) => (derived = resolve));
  const spy = vi
    .spyOn(crypto.subtle, 'deriveBits')
    .mockImplementation(async (algorithm, baseKey, length) => {
      if (base64url.encode((algorithm as Pbkdf2Params).salt as Uint8Array) === salt) {
        reach();
        await released;
        return deriveBits(algorithm, baseKey, length);
      }
      const bits = await deriveBits(algorithm, baseKey, length);
      derived();
      return bits;
    });
  return { reached, othersDerived, release, restore: () => spy.mockRestore() };
}

/** Long enough for a change that is not held back to be written. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
const saltOf = async (secure: SecureStorage) =>
  (JSON.parse((await secure.get('lock:passcode'))!) as { salt: string }).salt;

describe('device lock: enrolments and clear() wait for a passcode check under way', () => {
  it('keeps a passcode enrolled while the old one was being checked', async () => {
    const secure = secureStorage();
    const lock = createLock({ storage: secure, credentials: undefined });
    await lock.enrollPasscode('246810');
    const held = holdDerivation(await saltOf(secure));
    try {
      const check = lock.verifyPasscode('246810');
      await held.reached; // the attempt is counted, and the check is deriving
      const enrol = lock.enrollPasscode('135790');
      await held.othersDerived; // the new passcode is hashed: stored now, or waiting for the check
      await Promise.race([enrol, settle()]);
      held.release();
      expect(await check).toEqual({ ok: true, attemptsLeft: 5 });
      await enrol;
    } finally {
      held.restore();
    }
    expect(await lock.verifyPasscode('135790')).toEqual({ ok: true, attemptsLeft: 5 });
  });

  it('leaves no passcode behind when WebAuthn is enrolled while it was being checked', async () => {
    const auth = await fakeAuthenticator();
    const secure = secureStorage();
    const lock = lockOver(auth.credentials, secure);
    await lock.enrollPasscode('246810');
    const held = holdDerivation(await saltOf(secure));
    try {
      const check = lock.verifyPasscode('246810');
      await held.reached;
      const enrol = lock.enrollWebAuthn(ada);
      await Promise.race([enrol, settle()]); // create() answers at once: stored now, or waiting
      held.release();
      await check;
      await enrol;
    } finally {
      held.restore();
    }
    expect(await lock.enrolled()).toBe('webauthn');
    expect(await secure.get('lock:passcode')).toBeNull();
  });

  it('stays cleared when clear() comes while a passcode is being checked', async () => {
    const secure = secureStorage();
    const lock = createLock({ storage: secure, credentials: undefined });
    await lock.enrollPasscode('246810');
    const held = holdDerivation(await saltOf(secure));
    try {
      const check = lock.verifyPasscode('246810');
      await held.reached;
      const cleared = lock.clear();
      await Promise.race([cleared, settle()]);
      held.release();
      expect(await check).toEqual({ ok: true, attemptsLeft: 5 });
      await cleared;
    } finally {
      held.restore();
    }
    expect(await lock.enrolled()).toBeNull();
  });
});
