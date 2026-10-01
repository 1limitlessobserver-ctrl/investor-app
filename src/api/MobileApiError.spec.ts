import { describe, it, expect } from 'vitest';
import { MobileApiError } from './MobileApiError';

describe('MobileApiError', () => {
  it('carries the envelope', () => {
    const e = new MobileApiError('invalid_input', 400, 'Check the highlighted fields.', {
      fields: { amountCents: 'Use whole cents.' },
    });
    expect(e).toBeInstanceOf(Error);
    expect([
      e.code,
      e.status,
      e.message,
      e.fields.amountCents,
      e.detail,
      e.retryAfterSeconds,
    ]).toEqual([
      'invalid_input',
      400,
      'Check the highlighted fields.',
      'Use whole cents.',
      [],
      null,
    ]);
    expect(MobileApiError.is(e)).toBe(true);
    expect(MobileApiError.is(new Error('x'))).toBe(false);
  });
  it('has a calm default message per code', () => {
    expect(new MobileApiError('rate_limited', 429).message).toBe(
      'Too many attempts. Please wait a moment and try again.',
    );
    expect(MobileApiError.network().message).toBe('You appear to be offline.');
    expect(new MobileApiError('something_new', 418).message).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('MobileApiError details', () => {
  it('keeps what the envelope carried', () => {
    const limited = new MobileApiError('rate_limited', 429, undefined, { retryAfterSeconds: 30 });
    expect(limited.retryAfterSeconds).toBe(30);
    const weak = new MobileApiError('weak_password', 400, 'No.', {
      detail: ['must include a digit'],
    });
    expect(weak.detail).toEqual(['must include a digit']);
  });
  it('accepts an envelope whose optional parts are undefined', () => {
    const e = new MobileApiError('invalid_input', 400, 'Check the fields.', {
      fields: undefined,
      detail: undefined,
      retryAfterSeconds: undefined,
    });
    expect([e.fields, e.detail, e.retryAfterSeconds]).toEqual([{}, [], null]);
  });
  it('prefers what the platform said, and falls back when it said nothing', () => {
    expect(new MobileApiError('rate_limited', 429, 'Wait a minute.').message).toBe(
      'Wait a minute.',
    );
    expect(new MobileApiError('session_revoked', 401, '').message).toBe(
      'This session has ended. Sign in again.',
    );
    expect(new MobileApiError('server_error', 500, '  ').message).toBe(
      'The platform had a problem. Your session is safe — try again.',
    );
  });
  it('has a calm default for every code the app needs one for', () => {
    const defaults = {
      unauthorized: 'Sign in to continue.',
      session_revoked: 'This session has ended. Sign in again.',
      rate_limited: 'Too many attempts. Please wait a moment and try again.',
      server_error: 'The platform had a problem. Your session is safe — try again.',
      network: 'You appear to be offline.',
      upgrade_required: 'Please update the app to continue.',
      feature_disabled: 'This feature is not available right now.',
    };
    for (const [code, message] of Object.entries(defaults)) {
      expect(new MobileApiError(code, 400).message, code).toBe(message);
    }
  });
  it('does not mistake the name of an Object method for a code', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(new MobileApiError(code, 400).message, code).toBe(
        'Something went wrong. Please try again.',
      );
    }
  });
  it('is an Error named MobileApiError with the offline code and no status', () => {
    const e = MobileApiError.network();
    expect(e).toBeInstanceOf(MobileApiError);
    expect(e.name).toBe('MobileApiError');
    expect([e.code, e.status]).toEqual(['network', 0]);
  });
  it('recognises an error from another copy of the module, and nothing else', () => {
    const alien = {
      name: 'MobileApiError',
      code: 'x',
      status: 400,
      message: 'm',
      fields: {},
      detail: [],
      retryAfterSeconds: null,
    };
    expect(MobileApiError.is(alien)).toBe(true);
    expect(MobileApiError.is({ ...alien, fields: undefined })).toBe(false);
    expect(MobileApiError.is({ ...alien, fields: null })).toBe(false);
    expect(MobileApiError.is({ ...alien, detail: undefined })).toBe(false);
    expect(MobileApiError.is({ ...alien, message: undefined })).toBe(false);
    expect(MobileApiError.is({ name: 'MobileApiError' })).toBe(false);
    expect(MobileApiError.is(Object.assign(new Error('x'), { code: 'x', status: 400 }))).toBe(
      false,
    );
    expect(MobileApiError.is(null)).toBe(false);
    expect(MobileApiError.is('MobileApiError')).toBe(false);
  });
});
