// Every failure of a PlatformApi call is a MobileApiError, built from the platform's error envelope
//   { error: '<code>', message?: '<text to show>', fields?, detail?, ... }
// or by the app itself (`network`). Screens show `message`, map `fields` onto form fields and never
// show `code`.

/**
 * What an error says when the platform sent no `message`. Calm, short and free of codes. A code
 * that is not listed here (the platform adds some of its own) falls back to GENERIC_MESSAGE. A Map,
 * so that a code such as "constructor" cannot find something on Object.prototype.
 */
const DEFAULT_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['unauthorized', 'Sign in to continue.'],
  ['session_revoked', 'This session has ended. Sign in again.'],
  ['rate_limited', 'Too many attempts. Please wait a moment and try again.'],
  ['server_error', 'The platform had a problem. Your session is safe — try again.'],
  ['network', 'You appear to be offline.'],
  ['upgrade_required', 'Please update the app to continue.'],
  ['feature_disabled', 'This feature is not available right now.'],
]);

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** The parts of the envelope beyond the code and the message; each may be absent or undefined. */
export interface MobileApiErrorExtra {
  /** `invalid_input`: form field name to the message to show beside it. */
  fields?: Record<string, string> | undefined;
  /** Library errors that carry a list, such as `weak_password` and `share_exceeds_100`. */
  detail?: string[] | undefined;
  /** `rate_limited`: seconds to wait, from the body or the Retry-After header. */
  retryAfterSeconds?: number | null | undefined;
}

export class MobileApiError extends Error {
  /** The platform's error code (`invalid_input`, `pin_required`, ...), or `network` for the app's own. */
  readonly code: string;
  /** The HTTP status; 0 when no response arrived. */
  readonly status: number;
  readonly fields: Record<string, string>;
  readonly detail: string[];
  readonly retryAfterSeconds: number | null;

  constructor(code: string, status: number, message?: string, extra: MobileApiErrorExtra = {}) {
    // A blank message counts as none, so a screen never shows an empty error.
    super(
      message !== undefined && message.trim() !== ''
        ? message
        : (DEFAULT_MESSAGES.get(code) ?? GENERIC_MESSAGE),
    );
    // A subclass of Error keeps its own prototype only when built natively; this makes that certain.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'MobileApiError';
    this.code = code;
    this.status = status;
    this.fields = extra.fields ?? {};
    this.detail = extra.detail ?? [];
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
  }

  /** The request never got an answer: no connection, a dropped one or a blocked one. */
  static network(): MobileApiError {
    return new MobileApiError('network', 0);
  }

  /**
   * True for a MobileApiError, including one built by another copy of this module (a second
   * bundle or a hot reload), where `instanceof` fails: those are recognised by their name and shape.
   */
  static is(e: unknown): e is MobileApiError {
    if (e instanceof MobileApiError) return true;
    if (typeof e !== 'object' || e === null) return false;
    const candidate = e as Partial<Record<keyof MobileApiError, unknown>>;
    return (
      candidate.name === 'MobileApiError' &&
      typeof candidate.code === 'string' &&
      typeof candidate.status === 'number' &&
      typeof candidate.message === 'string' &&
      typeof candidate.fields === 'object' &&
      candidate.fields !== null &&
      Array.isArray(candidate.detail)
    );
  }
}
