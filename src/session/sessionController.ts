// The session on this device, as a small store outside React (AppSession.tsx renders it), so its
// rules run the same from a tap, a timer or a callback of the platform client: who is signed in,
// whether the app is locked, the confirmation before a money action, the offer to set up a device
// lock, and the device's online state.
//
//  - Launch: a stored session (live: the token store holds one; sample: this tab's flag) opens
//    locked whenever a lock is set up on the device, whatever the setting; with none, it ends
//    (never unlocked) when the lock is on, else it opens signed in.
//  - The lock belongs to the session: a fresh sign-in wipes any lock left on the device and
//    offers the setup; sign-out wipes it too, with its setting, once the session has left the
//    store. A session that may still be stored keeps them, so the next launch still asks.
//  - The lock is on once the investor sets one up, until they turn it off (app.lockEnabled); with
//    no choice stored, a lock that is set up counts as on ("Not now" stores none). It locks after
//    five minutes hidden while on; launch, lock() and confirmations ask whatever it says.
//    The device's lock is read afresh before each of these, and when another tab changes it; a
//    read that fails decides nothing (a confirmation is then refused, and the investor told).
//  - Nothing left to check the investor (the app locked, the lock on, or a lock the session knew,
//    and no lock on the device): the session ends here, at launch or on any of these, without
//    telling the platform, as this tab may be behind a newer sign-in made elsewhere. The last
//    wrong passcode signs out, whatever became of its sheet.
//  - Push: once a session opens signed in (a sign-in, a launch straight in, or the unlock that
//    follows a launch that opened locked), this browser's push subscription is handed to the
//    platform where push can be on (src/session/push.ts), once per session.
//  - Sign-out: the platform first: that push ends, then that this tab's sign-in does (each waited
//    for 3 s at most); then the store, the lock, the browser's push, the cache and the flag. The
//    client's onSignedOut (and the sample's) ends the session the same way without the platform,
//    and nothing else does: a rejected call never signs out on its own. A session that ends
//    other than by the investor says why on the sign-in screen.
//  - The session knows the key of the sign-in it holds, and ends only that one in the store. Each
//    change of session moves a generation: a step that answers after it moved (a read, a sign-out
//    waiting on the platform, an end waiting on push) stops there, and a decision made on what
//    was read before (a lock found gone, another tab's sign-out, the platform's onSignedOut, an
//    unlock) looks at the store again first: a newer sign-in found there is followed, not ended.
//  - Storage this device cannot read means signing in again, after a reset when its key is lost.
//    Every failure the app carries on from is reported to the console (src/lib/report.ts).

import { hashKey, onlineManager, type QueryClient } from '@tanstack/react-query';
import { MobileApiError } from '../api/MobileApiError';
import type { SignedOutReason } from '../api/createLiveApi';
import type { PlatformApi } from '../api/PlatformApi';
import type { Brand, LoginResult, MobileTokens } from '../api/types';
import type { ThemeId } from '../design/themes';
import { reportProblem } from '../lib/report';
import { isBelowMinimum } from '../lib/semver';
import type { LockMethod, Platform } from '../platform/types';
import { workerReady as serviceWorkerReady } from '../pwa/workerReady';
import { brandQuery, meQuery } from '../queries/identity';
import { themeChoice } from './brand';
import { deviceHandle } from './deviceId';
import { lockPreference, sampleFlag } from './localFlags';
import { createPushRegistration } from './push';
import type { SessionTokenStore, TokenStoreEvent } from './tokens';

/** How long the app may stay hidden before it locks. */
export const LOCK_AFTER_MS = 5 * 60_000;
/**
 * How long a sign-out waits for the platform to hear of it. The live client clears the stored
 * session before it sends, so the sign-out can go on without the answer.
 */
const LOGOUT_WAIT_MS = 3_000;
/** How long a sign-out waits for the platform to hear that this browser's push ends. */
const PUSH_UNREGISTER_WAIT_MS = 3_000;
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
  deviceUnchecked: "Your device's own lock couldn't be checked. You can set a passcode instead.",
  passcodeFailed: "The passcode couldn't be saved on this device. Try again.",
  sessionNotSaved: 'Could not save your session on this device.',
  sessionNotCleared:
    "Your session couldn't be fully removed from this device. Clear this site's data to remove it.",
  turnOffLock: 'Turn off the app lock',
  // Why the session ended, when the investor did not end it: shown on the sign-in screen.
  endedStorage:
    "This device couldn't read your session, so you've been signed out. Nothing was sent.",
  endedByPlatform: 'Your session ended. Sign in again.',
  endedLockGone: "The app lock on this device is gone, so you've been signed out.",
  endedElsewhere: 'You signed out on another tab.',
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
  /**
   * Whether the app's service worker is active, which push needs: the browser's own (waited for
   * five seconds at most) unless a spec says.
   */
  workerReady?: (() => Promise<boolean>) | undefined;
}

type Check = { ok: boolean; attemptsLeft?: number | undefined };

/**
 * Why the session ends on this device: the investor signed out; the platform revoked it or refused
 * its refresh; this device could not read it; nothing is left to unlock it; or another tab signed
 * out.
 */
export type EndReason =
  'investor' | 'revoked' | 'refresh_failed' | 'storage' | 'lock_gone' | 'elsewhere';

/** What the sign-in screen says of a session that ended other than by the investor. */
const ENDED: Record<Exclude<EndReason, 'investor'>, string> = {
  revoked: SESSION_COPY.endedByPlatform,
  refresh_failed: SESSION_COPY.endedByPlatform,
  storage: SESSION_COPY.endedStorage,
  lock_gone: SESSION_COPY.endedLockGone,
  elsewhere: SESSION_COPY.endedElsewhere,
};

/** What the device offers for a lock, and why not its own lock when it could not say. */
type DeviceOffer = { available: LockMethod; error?: string | undefined };

/** What a fresh look at the device's lock found: see refreshLock(). */
type LockRead = 'stands' | 'gone' | 'unread';

/** A sign-out or an end of the session under way, and the generation it started. */
type Ending = { gen: number; done: Promise<void> };

/** Where ending a session left the store: see leaveStore(). */
type Left = 'gone' | 'replaced' | 'kept';

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
  const minimum: unknown = brand?.minSupportedAppVersion;
  const fromBrand =
    typeof minimum === 'string' && isBelowMinimum(appVersion, minimum) ? minimum : null;
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
    onSignedOut: (reason) => {
      void endUnlessMoved(reason === 'refresh_failed' ? reason : 'revoked', generation);
    },
    onUpgradeRequired: (minVersion) => upgradeRequired(minVersion),
    onStorageError: (error) => {
      reportProblem('saving the session', error);
      set({ notice: SESSION_COPY.sessionNotSaved });
    },
  };
  const api = deps.makeApi({ events, tokenStore });
  const live = api.mode === 'live';
  const brandHash = hashKey(brandQuery(api).queryKey);
  const push = createPushRegistration({
    api,
    notifications: platform.notifications,
    brand: () => queryClient.ensureQueryData(brandQuery(api)),
    workerReady: deps.workerReady ?? (() => serviceWorkerReady()),
  });

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
  // The key of the sign-in this tab holds (live): what ending it here clears, and nothing else.
  let sessionKey: string | null = null;
  let launched = false;
  let hiddenAt: number | null = null;
  let nextId = 0;
  let settleConfirmation: ((ok: boolean) => void) | null = null;
  let settleSetup: ((done: boolean) => void) | null = null;
  let leaving: Ending | null = null;
  let ending: Ending | null = null;
  // The investor's lock choice when this device could not save it: it holds for this visit.
  let unsavedChoice: boolean | null = null;
  // The generation whose session push was last turned on for: once per session.
  let pushedFor: number | null = null;
  // The user handle of this install's device credentials, made now so that the tap that enrols
  // one asks the browser at once (its prompt needs the tap).
  let handle: Uint8Array | undefined;
  deviceHandle().then(
    (bytes) => (handle = bytes),
    (error: unknown) => reportProblem('making the device handle', error),
  );

  function set(patch: Partial<SessionState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  const lockEnabled = () => state.lockChoice ?? state.lockMethod !== null;

  /** The investor's lock choice as kept: on the device, or in this visit when it could not be. */
  const storedChoice = () => unsavedChoice ?? lockPreference.read();

  /** Keeps the investor's lock choice; one the device cannot save holds for this visit. */
  function saveChoice(on: boolean): void {
    unsavedChoice = lockPreference.write(on) ? null : on;
    set({ lockChoice: on });
  }

  /** Back to no choice: the next sign-in on this device decides afresh. */
  function forgetChoice(): void {
    unsavedChoice = null;
    lockPreference.clear();
  }

  function updateIsRequired(): boolean {
    const brand = queryClient.getQueryData(brandQuery(api).queryKey) ?? null;
    return updateRequiredFor(brand, state.upgradeRequired, appVersion) !== null;
  }

  // ---- Launch -----------------------------------------------------------------------------

  async function launch(): Promise<void> {
    const gen = ++generation;
    if (state.status !== 'loading') set({ status: 'loading' });
    try {
      let stored = sampleFlag.read();
      if (live) {
        const held = await tokenStore.get();
        if (gen !== generation) return;
        sessionKey = held?.sessionKey ?? null;
        stored = held !== null;
      }
      if (!stored) {
        set({ status: 'signed-out', lockMethod: null });
        return;
      }
      const method = await platform.lock.enrolled();
      if (gen !== generation) return;
      const choice = storedChoice();
      if (method !== null) {
        // A lock on the device always asks at launch (so "Lock now" outlasts a reload): the
        // setting governs only the lock after five minutes away.
        set({ status: 'locked', lockMethod: method, lockChoice: choice, unlocking: IDLE });
      } else if (choice === true) {
        // The lock is on and nothing can unlock it any more: the app never opens unlocked. The
        // session ends here only: this tab may be behind the shared store, and telling the
        // platform could end a newer sign-in made elsewhere.
        await endUnlessMoved('lock_gone', gen);
      } else {
        set({ status: 'signed-in', lockMethod: null, lockChoice: choice });
        turnOnPush(gen);
      }
    } catch (error) {
      reportProblem('opening the session', error);
      if (gen === generation) await storageFailed(error);
    }
  }

  // ---- Signing in and out ------------------------------------------------------------------

  async function signIn(tokens: MobileTokens): Promise<void> {
    const gen = ++generation;
    closeFlows();
    if (state.notice !== null) set({ notice: null }); // what ended the last session is old news
    // A lock belongs to the session that set it up: one an earlier session left on this device is
    // wiped before this one starts, never adopted. A lock that cannot be wiped stops the sign-in.
    await forgetLock();
    if (gen !== generation) return;
    const key = live ? await startSession(tokens) : null;
    if (!live) sampleFlag.write();
    if (gen !== generation) return;
    sessionKey = key;
    set({ status: 'signed-in', lockMethod: null, lockChoice: null, unlocking: IDLE });
    turnOnPush(gen);
    void offerLockAfterSignIn(gen);
  }

  /**
   * Turns push on for the session open now (generation `gen`), once: a lock and an unlock keep
   * the session, and what it handed over. A step that answers once the session moved on stops.
   */
  function turnOnPush(gen: number): void {
    if (pushedFor === gen) return;
    pushedFor = gen;
    void push.register(() => gen === generation);
  }

  /** Wipes the device lock and its setting; storage whose key is lost is reset, lock and all. */
  async function forgetLock(): Promise<void> {
    forgetChoice();
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

  /**
   * Stores a sign-in, and resolves its session key; storage whose key is lost is reset and tried
   * once more.
   */
  async function startSession(tokens: MobileTokens): Promise<string> {
    try {
      try {
        return await tokenStore.start(tokens);
      } catch (error) {
        if (!isUnreadableKey(error)) throw error;
        await platform.storage.reset();
        return await tokenStore.start(tokens);
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

  /** A sign-out or an end of this session is under way: nothing more is asked of the investor. */
  const leavingNow = () => leaving?.gen === generation || ending?.gen === generation;

  /**
   * The investor's own sign-out: the platform is told, then the session ends here. Once only: a
   * second tap joins the first. A session that begins while the platform is waited for (another
   * tab signs in, and this one follows) is not this sign-out's to end.
   */
  function signOut(): Promise<void> {
    if (leaving?.gen === generation) return leaving.done;
    if (ending?.gen === generation) return ending.done;
    closeFlows(); // an open confirmation ends at once
    const gen = ++generation;
    // The platform hears of this tab's sign-in only: one another tab made since is not this tap's.
    const key = sessionKey ?? undefined;
    const done = (async () => {
      // The platform hears that this browser's push ends while the session can still say so.
      try {
        await settled(push.unregister(), PUSH_UNREGISTER_WAIT_MS);
      } catch (error) {
        reportProblem('signing out: telling the platform push ends', error);
      }
      try {
        await settled(api.logout(key), LOGOUT_WAIT_MS);
      } catch (error) {
        // Only a store that fails makes logout reject; the end that follows clears the session
        // here, or keeps its lock and says the session couldn't be fully removed.
        reportProblem('signing out: telling the platform', error);
      }
      if (gen === generation) await endHere('investor');
    })().finally(() => {
      if (leaving?.gen === gen) leaving = null;
    });
    leaving = { gen, done };
    return done;
  }

  /**
   * Ends the session on this device, without telling the platform: this sign-in leaves the store
   * (by its key: one stored since is not this session's), then, once the store holds no session,
   * the device's lock and its setting; then push, the cache and the sample flag, and sign-in
   * shows. A session that may still be stored keeps its lock and setting, so the next launch asks
   * for the lock; a newer sign-in stored meanwhile keeps its own. A step that fails does not stop
   * the rest. A session that begins meanwhile (another tab signs in, and this one follows) stops
   * it before its next step: what the device holds is that session's now.
   */
  function endHere(reason: EndReason): Promise<void> {
    if (ending?.gen === generation) return ending.done;
    closeFlows();
    const gen = ++generation;
    const key = sessionKey;
    push.forget(); // what this session handed over is not the next one's to take back
    const moved = () => gen !== generation;
    const done = (async () => {
      const left = await leaveStore(key, reason);
      if (moved()) return;
      // The lock belongs to the session: the next sign-in here is offered the setup again.
      const lockGone =
        left === 'gone' ? await attempt('removing the lock', () => platform.lock.clear()) : true;
      if (moved()) return;
      if (left === 'gone') forgetChoice();
      const unsubscribe = () => settled(platform.notifications.unsubscribe(), UNSUBSCRIBE_WAIT_MS);
      await attempt('ending push', unsubscribe);
      if (moved()) return;
      queryClient.clear();
      sampleFlag.clear();
      sessionKey = null;
      // The sign-out goes on regardless, and the investor learns what this device still holds;
      // else why the session ended, unless they ended it.
      const notice =
        left === 'kept' || !lockGone
          ? SESSION_COPY.sessionNotCleared
          : reason === 'investor'
            ? state.notice
            : ENDED[reason];
      set({
        status: 'signed-out',
        lockMethod: null,
        lockChoice: null,
        unlocking: IDLE,
        confirmation: null,
        lockSetup: null,
        notice,
      });
    })().finally(() => {
      if (ending?.gen === gen) ending = null;
    });
    ending = { gen, done };
    return done;
  }

  /**
   * Ends the session for `reason`, found while the generation was `gen`: unless the session has
   * moved on since, or (live) the store holds another sign-in by now, which this tab then follows
   * instead. A store that cannot be read for this check ends the session all the same.
   */
  async function endUnlessMoved(reason: EndReason, gen: number): Promise<void> {
    if (live) {
      let stored: string | null;
      try {
        stored = (await tokenStore.get())?.sessionKey ?? null;
      } catch (error) {
        reportProblem('ending the session: reading the store', error);
        if (gen !== generation) return;
        if (isUnreadableKey(error)) await storageFailed(error);
        else await endHere(reason);
        return;
      }
      if (gen !== generation) return;
      if (stored !== null && stored !== sessionKey) {
        follow();
        return;
      }
    }
    await endHere(reason);
  }

  /**
   * Takes this tab's sign-in out of the store (live), by its key, and resolves where that leaves
   * the store: 'gone' when it holds no session now; 'replaced' when it holds another sign-in's, a
   * newer one, whose lock the device keeps; 'kept' when this sign-in may still be stored. With no
   * key known nothing is cleared, unless the investor signs out (then whatever is stored); and
   * whenever nothing was cleared, a fresh look at the store decides (one it cannot take: 'kept').
   */
  async function leaveStore(key: string | null, reason: EndReason): Promise<Left> {
    if (!live) return 'gone';
    if (key !== null || reason === 'investor') {
      try {
        if (await (key === null ? tokenStore.clear() : tokenStore.clear(key))) return 'gone';
      } catch (error) {
        reportProblem('ending the session: removing the session', error);
        // Storage whose key is lost is reset, which wipes it all.
        if (isUnreadableKey(error)) return (await resetStorage()) ? 'gone' : 'kept';
      }
    }
    try {
      const stored = (await tokenStore.get())?.sessionKey ?? null;
      if (stored === null) return 'gone';
      return key !== null && stored !== key ? 'replaced' : 'kept';
    } catch (error) {
      reportProblem('ending the session: reading the store', error);
      return isUnreadableKey(error) && (await resetStorage()) ? 'gone' : 'kept';
    }
  }

  /**
   * Runs a step of ending a session (`where` names it); a failure is reported and does not stop the
   * rest. Resolves whether it worked: storage whose key is lost counts once reset, as the reset
   * wipes it all.
   */
  async function attempt(where: string, step: () => Promise<unknown>): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (error) {
      reportProblem(`ending the session: ${where}`, error);
      return isUnreadableKey(error) ? resetStorage() : false;
    }
  }

  /** Resolves whether storage could be reset. */
  async function resetStorage(): Promise<boolean> {
    try {
      await platform.storage.reset();
      return true;
    } catch (error) {
      // The next launch reads what it cannot decrypt as no session.
      reportProblem('resetting secure storage', error);
      return false;
    }
  }

  /**
   * Storage this device cannot read: sign in again, after a reset when its key is lost. A session
   * that begins during the reset is not ended.
   */
  async function storageFailed(error: unknown): Promise<void> {
    const gen = generation;
    if (isUnreadableKey(error)) await resetStorage();
    if (gen === generation) await endHere('storage');
  }

  // ---- The lock ----------------------------------------------------------------------------

  /**
   * Reads the lock as the device has it now: another tab may have set one up, turned it off or
   * removed it, so the session never goes by what it saw at launch. When nothing can check the
   * investor any more (a locked app, the lock on, or a lock this session knew, with no lock left
   * on the device) the session ends here, as at launch, without telling the platform. Resolves
   * 'stands' while the session does, 'gone' once it ended or moved on, and 'unread' when the lock
   * could not be read: that decides nothing, and the session keeps what it knew (a lost key,
   * though, resets storage and signs out).
   */
  async function refreshLock(): Promise<LockRead> {
    const gen = generation;
    const knew = state.lockMethod !== null;
    let method: LockMethod | null;
    try {
      method = await platform.lock.enrolled();
    } catch (error) {
      if (gen !== generation) return 'gone';
      reportProblem('reading the device lock', error);
      if (!isUnreadableKey(error)) return 'unread';
      await storageFailed(error);
      return 'gone';
    }
    if (gen !== generation) return 'gone';
    const choice = storedChoice();
    if (method !== state.lockMethod || choice !== state.lockChoice) {
      set({ lockMethod: method, lockChoice: choice });
    }
    // A lock that was there and is gone ends the session whatever the lock's setting says: the
    // last wrong passcode wipes it, and a confirmation must never then go through unasked.
    if (method === null && (knew || state.status === 'locked' || lockEnabled())) {
      void endUnlessMoved('lock_gone', gen);
      return 'gone';
    }
    return 'stands';
  }

  function lockNow(): void {
    closeFlows();
    set({ status: 'locked', unlocking: IDLE });
  }

  /**
   * "Lock now": locks whenever a lock is set up, at once as known, then as the device says. With no
   * lock on the device it does nothing (the setting is no matter).
   */
  function lock(): void {
    if (state.status !== 'signed-in') return;
    if (state.lockMethod !== null) lockNow();
    void refreshLock().then((read) => {
      if (read === 'stands' && state.status === 'signed-in' && state.lockMethod !== null) {
        lockNow();
      }
    });
  }

  /**
   * After five minutes hidden: locks while the lock is on, at once as the session knows it, then
   * as the device says (which ends the session when nothing can unlock it).
   */
  function lockAfterHidden(): void {
    if (state.status !== 'signed-in') return;
    if (lockEnabled() && state.lockMethod !== null) lockNow();
    void refreshLock().then((read) => {
      const on = lockEnabled() && state.lockMethod !== null;
      if (read === 'stands' && state.status === 'signed-in' && on) lockNow();
    });
  }

  /**
   * The lock screen's check: the device prompt (call it inside the tap) or the passcode. It
   * unlocks once the platform still knows the session: a revoked one signs out on the way.
   */
  function unlock(passcode?: string): Promise<boolean> {
    const { status, lockMethod: method, unlocking } = state;
    if (status !== 'locked' || method === null || unlocking.busy || leavingNow()) {
      return Promise.resolve(false);
    }
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
    // Does the platform still know the session? Asked only while online: offline, the app opens on
    // what it has (a fetch of `me` paused offline would never answer). A fetch already under way
    // is set aside, so the answer is a fresh one.
    if (state.online) {
      const me = meQuery(api);
      try {
        await queryClient.cancelQueries({ queryKey: me.queryKey });
        await queryClient.fetchQuery({ ...me, staleTime: 0, retry: false, networkMode: 'always' });
      } catch (error) {
        // A session this device cannot read never opens: the cache's failure handler has already
        // ended it. Any other failure opens on what the app has: a revoked session has ended
        // through onSignedOut, and the rest is reported.
        if (MobileApiError.is(error) && error.code === 'storage_error') return false;
        if (!(MobileApiError.is(error) && error.code === 'session_revoked')) {
          reportProblem('unlocking: asking the platform', error);
        }
      }
    }
    if (gen !== generation || state.status !== 'locked') return false;
    // The store, as it is now: emptied or replaced by another tab unheard, it is followed instead.
    if (live && !(await stillStored(gen))) return false;
    set({ status: 'signed-in', unlocking: IDLE });
    turnOnPush(gen); // a session that opened locked turns push on once first unlocked
    return true;
  }

  /**
   * Whether the store still holds this tab's sign-in, read afresh before the app opens. Emptied or
   * replaced, the store is followed; unreadable, the app stays locked (or, its key lost, signs in
   * again). Also false once the session moved on.
   */
  async function stillStored(gen: number): Promise<boolean> {
    let stored: string | null;
    try {
      stored = (await tokenStore.get())?.sessionKey ?? null;
    } catch (error) {
      if (gen !== generation) return false;
      reportProblem('unlocking: reading the store', error);
      if (isUnreadableKey(error)) await storageFailed(error);
      else set({ unlocking: { busy: false, error: SESSION_COPY.checkFailed } });
      return false;
    }
    if (gen !== generation || state.status !== 'locked') return false;
    if (stored === sessionKey) return true;
    follow();
    return false;
  }

  // ---- Confirmations -----------------------------------------------------------------------

  async function confirm(reason: string, options: ConfirmOptions = {}): Promise<boolean> {
    if (state.status !== 'signed-in' || leavingNow()) return false;
    // The lock the device has now decides what the sheet asks for; unread, nothing is confirmed.
    const read = await refreshLock();
    if (read === 'unread') set({ notice: SESSION_COPY.checkFailed });
    if (read !== 'stands' || state.status !== 'signed-in') return false;
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
    const gen = generation;
    const current = () => (state.confirmation?.id === shown.id ? state.confirmation : null);
    check.then(
      (result) => {
        // The last wrong passcode signs out whatever became of the sheet meanwhile (a newer
        // confirmation, the lock): the device's limit cannot be cancelled away.
        if (!result.ok && method === 'passcode' && (result.attemptsLeft ?? 0) <= 0) {
          if (current() !== null) settle(false);
          if (gen === generation) void signOut();
          return;
        }
        const now = current();
        if (now === null) return;
        if (result.ok) settle(true);
        else {
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
    const offer = await whatTheDeviceOffers();
    if (gen !== generation) return;
    if (state.status !== 'signed-in' || state.lockMethod !== null || updateIsRequired()) return;
    void showLockSetup(offer);
  }

  /**
   * What the device offers. The investor's email names a device credential in its prompt, so it is
   * fetched meanwhile, for the tap to find in the cache. A device that cannot say is offered the
   * passcode, which needs nothing of it, and the investor is told why.
   */
  async function whatTheDeviceOffers(): Promise<DeviceOffer> {
    void queryClient.prefetchQuery(meQuery(api));
    try {
      return { available: await platform.lock.available() };
    } catch (error) {
      reportProblem('asking what the device offers', error);
      return { available: 'passcode', error: SESSION_COPY.deviceUnchecked };
    }
  }

  function showLockSetup({ available, error }: DeviceOffer): Promise<boolean> {
    settleSetup?.(false);
    return new Promise((resolve) => {
      settleSetup = resolve;
      set({ lockSetup: { id: ++nextId, available, busy: false, error } });
    });
  }

  /** Closes the setup: with the lock now set up, or none for now. */
  function finishSetup(enrolled: LockMethod | null): void {
    const resolve = settleSetup;
    settleSetup = null;
    if (enrolled !== null) recordLock(enrolled);
    // A confirmation waiting behind the setup no longer suggests it.
    const confirmation = state.confirmation && { ...state.confirmation, offerSetup: false };
    set({ lockSetup: null, confirmation });
    resolve?.(enrolled !== null);
  }

  /** A lock is now set up on this device: it is on, and confirmations ask for it. */
  function recordLock(method: LockMethod): void {
    saveChoice(true);
    set({ lockMethod: method });
  }

  /**
   * A setup answered that the lock is set up: the offer closes, if it is still the one shown. One
   * closed meanwhile (by the lock, an update, a newer offer) still has its lock recorded, as the
   * device has it now; a session that changed since does not take it up.
   */
  function setupDone(offer: LockSetupOffer, method: LockMethod, gen: number): void {
    if (state.lockSetup?.id === offer.id) finishSetup(method);
    else if (gen === generation) recordLock(method);
  }

  function setUpLockForConfirmation(): void {
    if (state.confirmation === null || state.lockSetup !== null) return;
    void whatTheDeviceOffers().then((offer) => {
      if (state.confirmation !== null) void showLockSetup(offer);
    });
  }

  /**
   * "Use Face ID / Touch ID / Windows Hello": the browser's prompt, inside the tap. The investor's
   * email names the credential, so none is made before it is known (the sheet's button waits).
   */
  function enrolDevice(): void {
    const offer = state.lockSetup;
    if (offer === null || offer.busy) return;
    const me = queryClient.getQueryData(meQuery(api).queryKey);
    if (me === undefined || me.email === '') return;
    const enrolling = platform.lock.enrollWebAuthn({ id: me.id, email: me.email, handle });
    set({ lockSetup: { ...offer, busy: true, error: undefined } });
    const gen = generation;
    enrolling.then(
      () => setupDone(offer, 'webauthn', gen),
      (error: unknown) => setupFailed(offer, 'webauthn', error),
    );
  }

  function enrolPasscode(code: string): void {
    const offer = state.lockSetup;
    if (offer === null || offer.busy) return;
    set({ lockSetup: { ...offer, busy: true, error: undefined } });
    const gen = generation;
    platform.lock.enrollPasscode(code).then(
      () => setupDone(offer, 'passcode', gen),
      (error: unknown) => setupFailed(offer, 'passcode', error),
    );
  }

  /** A setup of `tried` failed: the offer says so, in words for what was tried. */
  function setupFailed(offer: LockSetupOffer, tried: LockMethod, error: unknown): void {
    reportProblem('setting up the lock', error);
    if (state.lockSetup?.id !== offer.id) return;
    if (isUnreadableKey(error)) {
      void storageFailed(error);
      return;
    }
    // A browser that cannot hold a device credential is offered the passcode instead.
    const noDevice = error instanceof Error && error.message === NO_DEVICE_LOCK;
    set({
      lockSetup: {
        ...offer,
        available: noDevice ? 'passcode' : offer.available,
        busy: false,
        error:
          tried === 'passcode'
            ? SESSION_COPY.passcodeFailed
            : noDevice
              ? SESSION_COPY.deviceUnavailable
              : SESSION_COPY.deviceFailed,
      },
    });
  }

  async function setLockEnabled(on: boolean): Promise<boolean> {
    if (state.status !== 'signed-in') return false;
    const read = await refreshLock();
    if (read === 'unread') set({ notice: SESSION_COPY.checkFailed });
    if (read !== 'stands' || state.status !== 'signed-in') return false;
    if (!on) {
      if (!lockEnabled()) return true;
      const ok = await confirm(SESSION_COPY.turnOffLock);
      if (ok) saveChoice(false);
      return ok;
    }
    if (state.lockMethod !== null) {
      saveChoice(true);
      return true;
    }
    const gen = generation;
    const offer = await whatTheDeviceOffers();
    // The session may have changed while the device answered: nothing is offered then.
    if (gen !== generation || state.status !== 'signed-in') return false;
    return showLockSetup(offer);
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
    // The update screen covers everything: a confirmation or a setup waiting under it ends.
    closeFlows();
  }

  /** A brand fetched afresh may require a newer app: then the flows under the update end too. */
  function brandFetched(): void {
    if (updateIsRequired()) closeFlows();
  }

  /**
   * The store moved on from this tab's sign-in: what this tab fetched for it is forgotten, and the
   * session starts again from what is stored now.
   */
  function follow(): void {
    closeFlows();
    queryClient.clear();
    push.forget();
    void launch();
  }

  /** Another tab signed in or out: this one follows what is stored now. */
  function storeChanged(event: TokenStoreEvent): void {
    if (event.type === 'clear') {
      if (state.status !== 'signed-out') void endUnlessMoved('elsewhere', generation);
      return;
    }
    sessionKey = event.sessionKey;
    follow();
  }

  /** A query or mutation failed: one that could not read the session means signing in again. */
  function callFailed(error: unknown): void {
    if (state.status === 'signed-out' || state.status === 'loading') return;
    if (MobileApiError.is(error) && error.code === 'storage_error') {
      reportProblem('a call could not read the session', error);
      void storageFailed(error);
    }
  }

  /** Another tab may have set up, turned off or removed the lock: read it again. */
  function storageChanged(event: StorageEvent): void {
    if (!lockPreference.changedBy(event)) return;
    if (state.status === 'signed-in' || state.status === 'locked') void refreshLock();
  }

  /** Listens to the device, the other tabs and the cache, and launches once. */
  function start(): () => void {
    const onNetwork = () => networkChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    window.addEventListener('storage', storageChanged);
    networkChanged();
    const stops = [
      live ? tokenStore.subscribe(storeChanged) : () => {},
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') return;
        if (event.action.type === 'error') {
          const error: unknown = event.action.error;
          callFailed(error);
        } else if (event.action.type === 'success' && event.query.queryHash === brandHash) {
          brandFetched();
        }
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
      window.removeEventListener('storage', storageChanged);
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
