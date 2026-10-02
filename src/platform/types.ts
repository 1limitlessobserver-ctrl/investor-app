// The app's only contact with the device: secure storage, the device lock, push notifications,
// file sharing, installation and haptics. src/platform/web implements them for browsers;
// sub-project 2 adds desktop implementations behind the same interfaces.
//
// For screen authors: some calls work only inside the investor's tap (a user gesture), so call
// them from the tap's own handler with what they need already at hand: notifications.request(),
// install.prompt(), share.files(), lock.enrollWebAuthn() and lock.verify().

import type { PushSubscriptionInput } from '../api/types';

/**
 * Key-value storage for secrets, sealed on this device. On the web that protects a value copied
 * out of storage, not a copy of the whole browser profile (web/storage.ts says how). The device
 * lock keeps its records here too, so sign-out removes the tokens with remove(): clear() would
 * also forget the lock, and reset() the key as well.
 */
export interface SecureStorage {
  /** The value, or null when there is none or it can no longer be decrypted. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes every value, the lock's records included; the key stays. */
  clear(): Promise<void>;
  /**
   * Removes every value and the key: "forget this device". Where the stored key cannot be read,
   * every other call rejects with `Error('The secure storage key cannot be read.')`; reset() is the
   * way on from there, before the investor signs in again.
   */
  reset(): Promise<void>;
}

export type LockMethod = 'webauthn' | 'passcode';

/**
 * The device lock that gates the app's screens; the platform session remains the real security.
 * The lock belongs to the device, not to an account: sign-out must call clear(), or whoever signs
 * in next on this device inherits it.
 */
export interface LockAdapter {
  /**
   * 'webauthn' where the device has a user-verifying platform authenticator and the browser hands
   * over a new credential's public key (getPublicKey; not iOS 15), else 'passcode'.
   */
  available(): Promise<LockMethod>;
  /**
   * The method whose record is stored on this device, or null when there is none. A record that
   * cannot be read still counts: verify() and verifyPasscode() fail closed on it and remove it.
   * Rejects when storage cannot be read: treat that as locked.
   */
  enrolled(): Promise<LockMethod | null>;
  /**
   * Creates a platform credential through the operating system's prompt (in the investor's tap),
   * stores it, and only then removes any passcode: a cancelled enrolment, or one whose credential
   * cannot be stored, leaves the lock as it was. When only that removal fails, the call rejects
   * with the credential enrolled; it outranks the passcode, which no longer unlocks. `user.email`
   * names the credential in the prompt; `user.id` is not used (the credential gets a random
   * handle). Throws `Error('This browser cannot enrol a device lock.')` where the browser has no
   * WebAuthn or hands over no public key this lock can use; the caller then offers the passcode. A
   * cancelled prompt rejects with the browser's own error.
   */
  enrollWebAuthn(user: { id: string; email: string }): Promise<void>;
  /**
   * Stores a six-digit passcode (anything else throws), and only then removes any WebAuthn
   * credential. Until both are done the lock stays as it was: when that removal fails, the call
   * rejects, the credential stays enrolled, and the next verifyPasscode() removes the passcode.
   */
  enrollPasscode(code: string): Promise<void>;
  /**
   * Runs the operating system's prompt (in the investor's tap); false when it is cancelled, fails
   * or does not verify, when no credential is enrolled, and when its record cannot be read (which
   * is then removed).
   */
  verify(): Promise<boolean>;
  /**
   * Checks the passcode. The fifth wrong attempt in a row wipes the passcode and answers
   * `attemptsLeft: 0`, and so does a check with no passcode enrolled, or with a record that cannot
   * be read (which is then removed): the caller then signs out. While a WebAuthn credential record
   * exists, which outranks the passcode as in enrolled(), it answers `attemptsLeft: 0` too and
   * removes the passcode, checking nothing.
   * Each attempt is counted before it is checked, so when storage cannot count it the call
   * rejects and nothing is checked.
   */
  verifyPasscode(code: string): Promise<{ ok: boolean; attemptsLeft: number }>;
  /** Forgets both enrolments. */
  clear(): Promise<void>;
}

export interface NotificationsAdapter {
  /** The browser's notification permission, or 'unsupported' where there is no Web Push. */
  permission(): 'default' | 'granted' | 'denied' | 'unsupported';
  /**
   * Asks for permission, in the investor's tap: Firefox answers 'denied' without asking otherwise.
   * A prompt closed without an answer counts as 'denied'.
   */
  request(): Promise<'granted' | 'denied' | 'unsupported'>;
  /**
   * This browser's push subscription for the platform's VAPID key (base64url), in the form
   * POST /push/subscribe takes: the one it holds for that key, else a new one (one held for another
   * key is ended first). Rejects with `Error('The push key (vapidPublicKey) is not a valid P-256
   * public key.')` for any key but 65 bytes from 0x04, touching nothing, and where no service
   * worker is registered, or it has no push.
   */
  subscribe(vapidPublicKey: string): Promise<PushSubscriptionInput>;
  /**
   * Ends the push subscription and answers the endpoint it had, for /push/unsubscribe; null when
   * there is none, or no service worker with push to hold one. Rejects when the lookup of the
   * worker fails.
   */
  unsubscribe(): Promise<string | null>;
  /** Shows a notification with the app's icon and badge; rejects where no worker is registered. */
  show(n: { title: string; body?: string | undefined; tag?: string | undefined }): Promise<void>;
}

export interface ShareAdapter {
  /**
   * Offers the files to the system share sheet where it takes files, else downloads them. Call it
   * inside the investor's tap with the files already built: the browser shares only during that
   * tap's activation, and once it has lapsed the share rejects (NotAllowedError) and the files are
   * downloaded instead. 'cancelled' when the investor closes the sheet, or one is already open.
   */
  files(files: File[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'>;
}

export interface InstallAdapter {
  /** True while the browser has offered an install prompt that has not been used. */
  canPrompt(): boolean;
  /**
   * Shows the browser's install prompt once, in the investor's tap; 'unavailable' when there is
   * none to show, a prompt is already showing, or the browser refuses (refused for want of a user
   * gesture, the prompt is kept for the next tap).
   */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** True when the app runs installed (standalone), or was installed during this visit. */
  isInstalled(): boolean;
  /** Which manual install steps to show in Safari, which has no install prompt; else null. */
  hint(): 'safari-ios' | 'safari-mac' | null;
  /** Calls the listener whenever what the adapter answers may have changed. */
  subscribe(listener: () => void): () => void;
}

export interface HapticsAdapter {
  tick(): void;
  success(): void;
  warn(): void;
}

export interface Platform {
  kind: 'web' | 'desktop';
  storage: SecureStorage;
  lock: LockAdapter;
  notifications: NotificationsAdapter;
  share: ShareAdapter;
  install: InstallAdapter;
  haptics: HapticsAdapter;
}
