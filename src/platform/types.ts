// The app's only contact with the device: secure storage, the device lock, push notifications,
// file sharing, installation and haptics. src/platform/web implements them for browsers;
// sub-project 2 adds desktop implementations behind the same interfaces.

import type { PushSubscriptionInput } from '../api/types';

/**
 * Key-value storage for secrets, sealed on this device. On the web that protects a value copied
 * out of storage, not a copy of the whole browser profile (web/storage.ts says how).
 */
export interface SecureStorage {
  /** The value, or null when there is none or it can no longer be decrypted. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes every value. */
  clear(): Promise<void>;
  /**
   * Removes every value and the key. Where the stored key cannot be read, every other call rejects
   * with `Error('The secure storage key cannot be read.')`; reset() is the way on from there.
   */
  reset(): Promise<void>;
}

export type LockMethod = 'webauthn' | 'passcode';

/** The device lock that gates the app's screens; the platform session remains the real security. */
export interface LockAdapter {
  /**
   * 'webauthn' where the device has a user-verifying platform authenticator and the browser hands
   * over a new credential's public key (getPublicKey; not iOS 15), else 'passcode'.
   */
  available(): Promise<LockMethod>;
  /**
   * The method whose record is stored on this device, or null when there is none. A record that
   * cannot be read still counts: verify() and verifyPasscode() fail closed on it and remove it.
   */
  enrolled(): Promise<LockMethod | null>;
  /**
   * Creates a platform credential through the operating system's prompt and replaces any passcode.
   * Throws `Error('This browser cannot enrol a device lock.')` where the browser has no WebAuthn or
   * hands over no public key this lock can use; the caller then offers the passcode. A cancelled
   * prompt rejects with the browser's own error.
   */
  enrollWebAuthn(user: { id: string; email: string }): Promise<void>;
  /** Stores a six-digit passcode (anything else throws) and replaces any WebAuthn credential. */
  enrollPasscode(code: string): Promise<void>;
  /**
   * Runs the operating system's prompt; false when it is cancelled, fails or does not verify, when
   * no credential is enrolled, and when its record cannot be read (which is then removed).
   */
  verify(): Promise<boolean>;
  /**
   * Checks the passcode. The fifth wrong attempt in a row wipes the passcode and answers
   * `attemptsLeft: 0`, and so does a check with no passcode enrolled, or with a record that cannot
   * be read (which is then removed): the caller then signs out.
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
  /** Asks for permission; a prompt closed without an answer counts as 'denied'. */
  request(): Promise<'granted' | 'denied' | 'unsupported'>;
  /**
   * This browser's push subscription for the platform's VAPID key (base64url), in the form
   * POST /push/subscribe takes. Rejects where no service worker is registered.
   */
  subscribe(vapidPublicKey: string): Promise<PushSubscriptionInput>;
  /**
   * Ends the push subscription and answers the endpoint it had, for /push/unsubscribe; null when
   * there is none, or no service worker to hold one.
   */
  unsubscribe(): Promise<string | null>;
  /** Shows a notification with the app's icon and badge; rejects where no worker is registered. */
  show(n: { title: string; body?: string | undefined; tag?: string | undefined }): Promise<void>;
}

export interface ShareAdapter {
  /** Offers the files to the system share sheet where it takes files, else downloads them. */
  files(files: File[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'>;
}

export interface InstallAdapter {
  /** True while the browser has offered an install prompt that has not been used. */
  canPrompt(): boolean;
  /** Shows the browser's install prompt once; 'unavailable' when there is none to show. */
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
