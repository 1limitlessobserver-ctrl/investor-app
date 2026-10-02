// The session on this device, as a small store outside React (AppSession.tsx renders it), so its
// rules run the same from a tap, a timer or a callback of the platform client: who is signed in,
// whether the app is locked, the confirmation before a money action, the offer to set up a device
// lock, and the device's online state.
//
//  - Launch: a stored session (live: the token store holds one; sample: this tab's flag) opens
//    locked while the lock is on and set up, signed out (never unlocked) when it is on and no
//    longer set up, else signed in.
//  - The lock is on once the investor sets one up, until they turn it off (app.lockEnabled); with
//    no choice stored, a lock that is set up counts as on. It locks after five minutes hidden, on
//    lock() and at launch; confirmations always ask, whatever it says.
//  - Sign-out: the platform first, then the store, the lock, push, the cache and the flag. The
//    client's onSignedOut (and the sample's) ends the session the same way without the platform,
//    and nothing else does: a rejected call never signs out on its own.
//  - Storage this device cannot read means signing in again, after a reset when its key is lost.

import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { MobileApiError } from '../api/MobileApiError';
import type { SignedOutReason } from '../api/createLiveApi';
import type { PlatformApi } from '../api/PlatformApi';
import type { Brand, LoginResult, MobileTokens } from '../api/types';
import type { ThemeId } from '../design/themes';
import { isBelowMinimum } from '../lib/semver';
import type { LockMethod, Platform } from '../platform/types';
import { brandQuery, meQuery } from '../queries/identity';
import { themeChoice } from './brand';
import { lockPreference, sampleFlag } from './localFlags';
import type { SessionTokenStore, TokenStoreEvent } from './tokens';

/** How long the app may stay hidden before it locks. */
export const LOCK_AFTER_MS = 5 * 60_000;
/** How long a sign-out waits for the push subscription to end. */
const UNSUBSCRIBE_WAIT_MS = 3_000;
/** The sample world signs in any email; this one, and its two-factor code where it asks. */
const SAMPLE_SIGN_IN = { email: 'investor@sample.app', password: 'sample' };
const SAMPLE_CODE = '123456';
/** What secure storage and the lock say when they cannot do what was asked. */
const KEY_UNREADABLE = 'The secure storage key cannot be read.';
const NO_DEVICE_LOCK = 'This browser cannot enrol a device lock.';

/** What the lock, the confirmation and the setup say when something does not go through. */
export const SESSION_COPY = {
  notConfirmed: "Your device didn't confirm it's you.",
  checkFailed: "The lock couldn't be checked. Try again.",
  deviceUnavailable:
    "This browser can't use your face or fingerprint for the app. Set a passcode instead.",
  deviceFailed: "That didn't go through. Try again, or set a passcode.",
  passcodeFailed: "The passcode couldn't be saved on this device. Try again.",
  sessionNotSaved: 'Could not save your session on this device.',
  sessionNotCleared:
    "Your session couldn't be fully removed from this device. Clear this site's data to remove it.",
  turnOffLock: 'Turn off the app lock',
} as const;

export type SessionStatus = 'loading' | 'signed-out' | 'locked' | 'signed-in';

/** The lock screen's check. */
export interface Unlocking {
  busy: boolean;
  /** Why the last check did not unlock. */
  error?: string | undefined;
  /** After a wrong passcode, the attempts left. */
  attemptsLeft?: number | undefined;
}

export interface ConfirmOptions {
  amountCents?: number | undefined;
  currency?: string | undefined;
}

/** The confirmation on screen. */
export interface Confirmation extends ConfirmOptions {
  id: number;
  reason: string;
  /** No lock is set up on this device: the sheet suggests one. */
  offerSetup: boolean;
  busy: boolean;
  error: string | undefined;
  attemptsLeft: number | undefined;
}

/** The offer to set up a device lock, on screen. */
export interface LockSetupOffer {
  id: number;
  /** What this device offers. */
  available: LockMethod;
  busy: boolean;
  error: string | undefined;
}

export interface SessionState {
  status: SessionStatus;
  /** The lock set up on this device, as far as the session knows; null for none. */
  lockMethod: LockMethod | null;
  /** The investor's choice for the lock (app.lockEnabled); null until there is one. */
  lockChoice: boolean | null;
  /** A 426 said this version is too old: the version needed, or '' when it did not say. */
  upgradeRequired: string | null;
  online: boolean;
  /** The theme the investor picked on this device. */
  themeChoice: ThemeId | null;
  unlocking: Unlocking;
  confirmation: Confirmation | null;
  lockSetup: LockSetupOffer | null;
  /** A passing message, such as a session that could not be saved. */
  notice: string | null;
}

/** The platform client's callbacks, which the session answers. */
export interface SessionEvents {
  onSignedOut: (reason: SignedOutReason) => void;
  onUpgradeRequired: (minVersion: string) => void;
  onStorageError: (error: unknown) => void;
}

/** What the app's PlatformApi is made with: the session's callbacks and the token store. */
export interface ApiWiring {
  events: SessionEvents;
  tokenStore: SessionTokenStore;
}

export interface SessionDeps {
  makeApi: (wiring: ApiWiring) => PlatformApi;
  platform: Platform;
  queryClient: QueryClient;
  tokenStore: SessionTokenStore;
  appVersion: string;
}

type Check = { ok: boolean; attemptsLeft?: number | undefined };

const IDLE: Unlocking = { busy: false };

/** True when `error`, or what caused it, is secure storage's lost key. */
export function isUnreadableKey(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (current.message === KEY_UNREADABLE) return true;
    current = current.cause;
  }
  return false;
}

/** The token pair of a sign-in that needed no second step. */
export function tokensOf(result: LoginResult & { requiresTwoFactor: false }): MobileTokens {
  const { tokenType, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } = result;
  return { tokenType, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

/**
 * The version the app must update to, or '' when the platform did not say; null when none is
 * needed. A 426 counts, and so does a brand whose minimum is above this version.
 */
export function updateRequiredFor(
  brand: Brand | null,
  upgradeRequired: string | null,
  appVersion: string,
): string | null {
  const fromBrand =
    brand !== null && isBelowMinimum(appVersion, brand.minSupportedAppVersion)
      ? brand.minSupportedAppVersion
      : null;
  if (upgradeRequired === null) return fromBrand;
  return upgradeRequired !== '' ? upgradeRequired : (fromBrand ?? '');
}

async function settled<T>(promise: Promise<T>, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type SessionController = ReturnType<typeof createSessionController>;

export function createSessionController(deps: SessionDeps) {
  const { platform, queryClient, tokenStore, appVersion } = deps;
  const events: SessionEvents = {
    onSignedOut: () => void endHere(),
    onUpgradeRequired: (minVersion) => upgradeRequired(minVersion),
    onStorageError: () => set({ notice: SESSION_COPY.sessionNotSaved }),
  };
  const api = deps.makeApi({ events, tokenStore });
  const live = api.mode === 'live';

  let state: SessionState = {
    status: 'loading',
    lockMethod: null,
    lockChoice: lockPreference.read(),
    upgradeRequired: null,
    online: navigator.onLine,
    themeChoice: themeChoice.read(),
    unlocking: IDLE,
    confirmation: null,
    lockSetup: null,
    notice: null,
  };
  const listeners = new Set<() => void>();
  // Moves with every change of session; an async step that finds it moved stops there.
  let generation = 0;
  let launched = false;
  let hiddenAt: number | null = null;
  let nextId = 0;
  let settleConfirmation: ((ok: boolean) => void) | null = null;
  let settleSetup: ((done: boolean) => void) | null = null;
  let leaving: Promise<void> | null = null;
  let ending: Promise<void> | null = null;

  function set(patch: Partial<SessionState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  const lockEnabled = () => state.lockChoice ?? state.lockMethod !== null;

  function updateIsRequired(): boolean {
    const brand = queryClient.getQueryData(brandQuery(api).queryKey) ?? null;
    return updateRequiredFor(brand, state.upgradeRequired, appVersion) !== null;
  }

  // ---- Launch -----------------------------------------------------------------------------

  async function launch(): Promise<void> {
    const gen = ++generation;
    if (state.status !== 'loading') set({ status: 'loading' });
    try {
      const stored = live ? (await tokenStore.get()) !== null : sampleFlag.read();
      if (gen !== generation) return;
      if (!stored) {
        set({ status: 'signed-out', lockMethod: null });
        return;
      }
      const method = await platform.lock.enrolled();
      if (gen !== generation) return;
      const choice = lockPreference.read();
      if (!(choice ?? method !== null)) {
        set({ status: 'signed-in', lockMethod: method, lockChoice: choice });
      } else if (method !== null) {
        set({ status: 'locked', lockMethod: method, lockChoice: choice, unlocking: IDLE });
      } else {
        // The lock is on and nothing can unlock it any more: the app never opens unlocked.
        await signOut();
      }
    } catch (error) {
      if (gen === generation) await storageFailed(error);
    }
  }

  // ---- Signing in and out ------------------------------------------------------------------

  async function signIn(tokens: MobileTokens): Promise<void> {
    const gen = ++generation;
    closeFlows();
    // A lock belongs to the session that set it up: one an earlier session left on this device is
    // wiped before this one starts, never adopted. A lock that cannot be wiped stops the sign-in.
    await forgetLock();
    if (gen !== generation) return;
    if (live) await startSession(tokens);
    else sampleFlag.write();
    if (gen !== generation) return;
    set({ status: 'signed-in', lockMethod: null, lockChoice: null, unlocking: IDLE });
    void offerLockAfterSignIn(gen);
  }

  /** Wipes the device lock and its setting; storage whose key is lost is reset, lock and all. */
  async function forgetLock(): Promise<void> {
    lockPreference.clear();
    try {
      await platform.lock.clear();
    } catch (error) {
      try {
        if (!isUnreadableKey(error)) throw error;
        await platform.storage.reset();
      } catch (cause) {
        throw new MobileApiError('storage_error', 0, undefined, { cause });
      }
    }
  }

  /** Stores a sign-in; storage whose key is lost is reset and tried once more. */
  async function startSession(tokens: MobileTokens): Promise<void> {
    try {
      try {
        await tokenStore.start(tokens);
      } catch (error) {
        if (!isUnreadableKey(error)) throw error;
        await platform.storage.reset();
        await tokenStore.start(tokens);
      }
    } catch (cause) {
      throw new MobileApiError('storage_error', 0, undefined, { cause });
    }
  }

  async function enterSample(): Promise<void> {
    if (live) throw new Error('enterSample() is for sample mode only.');
    const first = await api.login(SAMPLE_SIGN_IN);
    const tokens = first.requiresTwoFactor
      ? await api.loginTwoFactor({ challenge: first.challenge, code: SAMPLE_CODE })
      : tokensOf(first);
    await signIn(tokens);
  }

  /** The investor's own sign-out: the platform is told, then the session ends here. */
  function signOut(): Promise<void> {
    leaving ??= (async () => {
      generation += 1;
      closeFlows();
      try {
        await api.logout();
      } catch {
        // Only a store that fails makes logout reject; ending the session here clears it anyway.
      }
      await endHere();
    })().finally(() => {
      leaving = null;
    });
    return leaving;
  }

  /** Ends the session on this device, without telling the platform. */
  function endHere(): Promise<void> {
    ending ??= (async () => {
      generation += 1;
      closeFlows();
      const tokensGone = live ? await attempt(() => tokenStore.clear()) : true;
      // The lock belongs to the session: the next sign-in here is offered the setup again.
      const lockGone = await attempt(() => platform.lock.clear());
      lockPreference.clear();
      await attempt(() => settled(platform.notifications.unsubscribe(), UNSUBSCRIBE_WAIT_MS));
      queryClient.clear();
      sampleFlag.clear();
      set({
        status: 'signed-out',
        lockMethod: null,
        lockChoice: null,
        unlocking: IDLE,
        confirmation: null,
        lockSetup: null,
        // The sign-out goes on regardless, and the investor learns what this device still holds.
        ...(tokensGone && lockGone ? {} : { notice: SESSION_COPY.sessionNotCleared }),
      });
    })().finally(() => {
      ending = null;
    });
    return ending;
  }

  /**
   * Runs a step of ending a session; a failure does not stop the rest. Resolves whether it worked:
   * storage whose key is lost counts once reset, as the reset wipes it all.
   */
  async function attempt(step: () => Promise<unknown>): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (error) {
      return isUnreadableKey(error) ? resetStorage() : false;
    }
  }

  /** Resolves whether storage could be reset. */
  async function resetStorage(): Promise<boolean> {
    try {
      await platform.storage.reset();
      return true;
    } catch {
      return false; // the next launch reads what it cannot decrypt as no session
    }
  }

  /** Storage this device cannot read: sign in again, after a reset when its key is lost. */
  async function storageFailed(error: unknown): Promise<void> {
    if (isUnreadableKey(error)) await resetStorage();
    await endHere();
  }

  // ---- The lock ----------------------------------------------------------------------------

  function lock(): void {
    if (state.status !== 'signed-in' || state.lockMethod === null) return;
    closeFlows();
    set({ status: 'locked', unlocking: IDLE });
  }

  /** After five minutes hidden: locks while the lock is on (signs out when nothing can unlock). */
  function lockAfterHidden(): void {
    if (state.status !== 'signed-in' || !lockEnabled()) return;
    if (state.lockMethod !== null) lock();
    else void signOut();
  }

  /**
   * The lock screen's check: the device prompt (call it inside the tap) or the passcode. It
   * unlocks once the platform still knows the session: a revoked one signs out on the way.
   */
  function unlock(passcode?: string): Promise<boolean> {
    const { status, lockMethod: method, unlocking } = state;
    if (status !== 'locked' || method === null || unlocking.busy) return Promise.resolve(false);
    let check: Promise<Check>;
    if (method === 'webauthn') check = platform.lock.verify().then((ok) => ({ ok }));
    else if (passcode === undefined) return Promise.resolve(false);
    else check = platform.lock.verifyPasscode(passcode);
    set({ unlocking: { busy: true, attemptsLeft: unlocking.attemptsLeft } });
    return finishUnlock(check, generation, method);
  }

  async function finishUnlock(check: Promise<Check>, gen: number, method: LockMethod) {
    let result: Check;
    try {
      result = await check;
    } catch (error) {
      if (gen !== generation) return false;
      if (isUnreadableKey(error)) await storageFailed(error);
      else set({ unlocking: { busy: false, error: SESSION_COPY.checkFailed } });
      return false;
    }
    if (gen !== generation) return false;
    if (!result.ok) {
      if (method === 'passcode' && (result.attemptsLeft ?? 0) <= 0) {
        await signOut();
      } else {
        set({
          unlocking:
            method === 'passcode'
              ? { busy: false, attemptsLeft: result.attemptsLeft }
              : { busy: false, error: SESSION_COPY.notConfirmed },
        });
      }
      return false;
    }
    try {
      await queryClient.fetchQuery({
        ...meQuery(api),
        staleTime: 0,
        retry: false,
        networkMode: 'always',
      });
    } catch {
      // Offline, or the platform failed: the app opens on what it has. A revoked session has
      // signed out through onSignedOut meanwhile.
    }
    if (gen !== generation || state.status !== 'locked') return false;
    set({ status: 'signed-in', unlocking: IDLE });
    return true;
  }

  // ---- Confirmations -----------------------------------------------------------------------

  function confirm(reason: string, options: ConfirmOptions = {}): Promise<boolean> {
    if (state.status !== 'signed-in') return Promise.resolve(false);
    settleConfirmation?.(false); // a newer confirmation replaces one still open
    return new Promise((resolve) => {
      settleConfirmation = resolve;
      set({
        confirmation: {
          id: ++nextId,
          reason,
          amountCents: options.amountCents,
          currency: options.currency,
          offerSetup: state.lockMethod === null,
          busy: false,
          error: undefined,
          attemptsLeft: undefined,
        },
      });
    });
  }

  function settle(ok: boolean): void {
    const resolve = settleConfirmation;
    settleConfirmation = null;
    set({ confirmation: null });
    resolve?.(ok);
  }

  /** The sheet's Confirm: the device prompt (inside the tap) or the passcode, or nothing. */
  function confirmWith(passcode?: string): void {
    const shown = state.confirmation;
    if (shown === null || shown.busy) return;
    const method = state.lockMethod;
    if (method === null) {
      settle(true);
      return;
    }
    let check: Promise<Check>;
    if (method === 'webauthn') check = platform.lock.verify().then((ok) => ({ ok }));
    else if (passcode === undefined) return;
    else check = platform.lock.verifyPasscode(passcode);
    set({ confirmation: { ...shown, busy: true, error: undefined } });
    const current = () => (state.confirmation?.id === shown.id ? state.confirmation : null);
    check.then(
      (result) => {
        const now = current();
        if (now === null) return;
        if (result.ok) settle(true);
        else if (method === 'passcode' && (result.attemptsLeft ?? 0) <= 0) {
          settle(false);
          void signOut();
        } else {
          set({
            confirmation: {
              ...now,
              busy: false,
              error: method === 'webauthn' ? SESSION_COPY.notConfirmed : undefined,
              attemptsLeft: method === 'passcode' ? result.attemptsLeft : undefined,
            },
          });
        }
      },
      (error: unknown) => {
        const now = current();
        if (now === null) return;
        if (isUnreadableKey(error)) {
          settle(false);
          void storageFailed(error);
        } else {
          set({ confirmation: { ...now, busy: false, error: SESSION_COPY.checkFailed } });
        }
      },
    );
  }

  // ---- Setting up the lock ------------------------------------------------------------------

  /** After a first sign-in on a device with no lock: offer one (not while an update is due). */
  async function offerLockAfterSignIn(gen: number): Promise<void> {
    const available = await whatTheDeviceOffers();
    if (available === null || gen !== generation) return;
    if (state.status !== 'signed-in' || state.lockMethod !== null || updateIsRequired()) return;
    void showLockSetup(available);
  }

  /**
   * What the device offers. The investor's email names a device credential in its prompt, so it is
   * fetched meanwhile, for the tap to find in the cache.
   */
  async function whatTheDeviceOffers(): Promise<LockMethod | null> {
    void queryClient.prefetchQuery(meQuery(api));
    try {
      return await platform.lock.available();
    } catch {
      return null; // no offer this time; the lock can be set up from Security
    }
  }

  function showLockSetup(available: LockMethod): Promise<boolean> {
    settleSetup?.(false);
    return new Promise((resolve) => {
      settleSetup = resolve;
      set({ lockSetup: { id: ++nextId, available, busy: false, error: undefined } });
    });
  }

  /** Closes the setup: with the lock now set up, or none for now. */
  function finishSetup(enrolled: LockMethod | null): void {
    const resolve = settleSetup;
    settleSetup = null;
    // A confirmation waiting behind the setup no longer suggests it.
    const confirmation = state.confirmation && { ...state.confirmation, offerSetup: false };
    if (enrolled !== null) {
      lockPreference.write(true);
      set({ lockSetup: null, lockMethod: enrolled, lockChoice: true, confirmation });
    } else {
      set({ lockSetup: null, confirmation });
    }
    resolve?.(enrolled !== null);
  }

  function setUpLockForConfirmation(): void {
    if (state.confirmation === null || state.lockSetup !== null) return;
    void whatTheDeviceOffers().then((available) => {
      if (available !== null && state.confirmation !== null) void showLockSetup(available);
    });
  }

  /** "Use Face ID / Touch ID / Windows Hello": the browser's prompt, inside the tap. */
  function enrolDevice(): void {
    const offer = state.lockSetup;
    if (offer === null || offer.busy) return;
    const me = queryClient.getQueryData(meQuery(api).queryKey);
    const enrolling = platform.lock.enrollWebAuthn({ id: me?.id ?? '', email: me?.email ?? '' });
    set({ lockSetup: { ...offer, busy: true, error: undefined } });
    enrolling.then(
      () => {
        if (state.lockSetup?.id === offer.id) finishSetup('webauthn');
      },
      (error: unknown) => setupFailed(offer, error),
    );
  }

  function enrolPasscode(code: string): void {
    const offer = state.lockSetup;
    if (offer === null || offer.busy) return;
    set({ lockSetup: { ...offer, busy: true, error: undefined } });
    platform.lock.enrollPasscode(code).then(
      () => {
        if (state.lockSetup?.id === offer.id) finishSetup('passcode');
      },
      (error: unknown) => setupFailed(offer, error),
    );
  }

  function setupFailed(offer: LockSetupOffer, error: unknown): void {
    if (state.lockSetup?.id !== offer.id) return;
    if (isUnreadableKey(error)) {
      void storageFailed(error);
      return;
    }
    // A browser that cannot hold a device credential is offered the passcode instead.
    const noDevice = error instanceof Error && error.message === NO_DEVICE_LOCK;
    const tried = state.lockSetup.available;
    set({
      lockSetup: {
        ...offer,
        available: noDevice ? 'passcode' : tried,
        busy: false,
        error:
          tried === 'webauthn'
            ? noDevice
              ? SESSION_COPY.deviceUnavailable
              : SESSION_COPY.deviceFailed
            : SESSION_COPY.passcodeFailed,
      },
    });
  }

  async function setLockEnabled(on: boolean): Promise<boolean> {
    if (state.status !== 'signed-in') return false;
    if (!on) {
      if (!lockEnabled()) return true;
      const ok = await confirm(SESSION_COPY.turnOffLock);
      if (ok) {
        lockPreference.write(false);
        set({ lockChoice: false });
      }
      return ok;
    }
    if (state.lockMethod !== null) {
      lockPreference.write(true);
      set({ lockChoice: true });
      return true;
    }
    const available = await whatTheDeviceOffers();
    return available === null ? false : showLockSetup(available);
  }

  /** Settles a confirmation and closes a setup that a change of session cut short. */
  function closeFlows(): void {
    const resolveConfirmation = settleConfirmation;
    const resolveSetup = settleSetup;
    settleConfirmation = null;
    settleSetup = null;
    if (state.confirmation !== null || state.lockSetup !== null) {
      set({ confirmation: null, lockSetup: null });
    }
    resolveConfirmation?.(false);
    resolveSetup?.(false);
  }

  // ---- The device and the platform ----------------------------------------------------------

  function visibilityChanged(): void {
    if (document.visibilityState === 'hidden') {
      hiddenAt ??= Date.now();
      return;
    }
    const since = hiddenAt;
    hiddenAt = null;
    // The time away, not a timer: a hidden page's timers may never run.
    if (since !== null && Date.now() - since >= LOCK_AFTER_MS) lockAfterHidden();
  }

  function networkChanged(): void {
    const online = navigator.onLine;
    onlineManager.setOnline(online);
    if (online !== state.online) set({ online });
  }

  function upgradeRequired(minVersion: string): void {
    // A version beats none: a 426 that names none keeps the one an earlier answer gave.
    const next = minVersion !== '' ? minVersion : (state.upgradeRequired ?? '');
    if (next !== state.upgradeRequired) set({ upgradeRequired: next });
  }

  /** Another tab signed in or out: this one follows what is stored now. */
  function storeChanged(event: TokenStoreEvent): void {
    if (event.type === 'clear') {
      if (state.status !== 'signed-out') void endHere();
      return;
    }
    closeFlows();
    queryClient.clear();
    void launch();
  }

  /** A query or mutation failed: one that could not read the session means signing in again. */
  function callFailed(error: unknown): void {
    if (state.status === 'signed-out' || state.status === 'loading') return;
    if (MobileApiError.is(error) && error.code === 'storage_error') void storageFailed(error);
  }

  /** Listens to the device, the other tabs and the cache, and launches once. */
  function start(): () => void {
    const onNetwork = () => networkChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    networkChanged();
    const stops = [
      live ? tokenStore.subscribe(storeChanged) : () => {},
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error: unknown = event.action.error;
        callFailed(error);
      }),
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error: unknown = event.action.error;
        callFailed(error);
      }),
    ];
    if (!launched) {
      launched = true;
      void launch();
    }
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
      for (const stop of stops) stop();
    };
  }

  return {
    api,
    platform,
    events,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): SessionState => state,
    start,
    signIn,
    enterSample,
    signOut,
    lock,
    unlock,
    confirm,
    confirmWith,
    cancelConfirmation: () => settle(false),
    setUpLockForConfirmation,
    enrolDevice,
    enrolPasscode,
    skipLockSetup: () => finishSetup(null),
    setLockEnabled,
    setTheme: (id: ThemeId): void => {
      themeChoice.write(id);
      set({ themeChoice: id });
    },
    dismissNotice: () => set({ notice: null }),
  };
}
