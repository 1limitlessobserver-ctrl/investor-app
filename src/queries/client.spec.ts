import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MobileApiError } from '../api/MobileApiError';
import { createQueryClient, retryQuery } from './client';

const error = (code: string, status: number) => new MobileApiError(code, status);

describe('retryQuery', () => {
  it('tries a query twice more after a server failure, then gives up', () => {
    const failed = error('server_error', 500);
    expect([0, 1, 2].map((n) => retryQuery(n, failed))).toEqual([true, true, false]);
    expect(retryQuery(0, error('oracle_unavailable', 503))).toBe(true);
    expect([0, 1, 2].map((n) => retryQuery(n, new TypeError('x')))).toEqual([true, true, false]);
  });

  it('never tries again what another try would answer the same, or what timed out', () => {
    for (const refused of [
      error('invalid_input', 400),
      error('session_revoked', 401),
      error('not_found', 404),
      error('rate_limited', 429),
      error('network', 0),
      error('timeout', 0),
      error('server_error', 200), // a 2xx whose body was not the route's answer
    ]) {
      expect(retryQuery(0, refused)).toBe(false);
    }
  });
});

describe('createQueryClient', () => {
  it('retries a failing query by the rule', async () => {
    const client = createQueryClient();
    const fails = vi.fn(() => Promise.reject(error('server_error', 502)));
    await expect(
      client.fetchQuery({ queryKey: ['sample', 'x'], queryFn: fails, retryDelay: 0 }),
    ).rejects.toMatchObject({ code: 'server_error' });
    expect(fails).toHaveBeenCalledTimes(3);
    const timesOut = vi.fn(() => Promise.reject(error('timeout', 0)));
    await expect(
      client.fetchQuery({ queryKey: ['sample', 'y'], queryFn: timesOut, retryDelay: 0 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(timesOut).toHaveBeenCalledTimes(1);
  });

  it('never sends a mutation twice, not even after a server failure', async () => {
    const client = createQueryClient();
    const send = vi.fn(() => Promise.reject(error('server_error', 500)));
    const observer = new MutationObserver(client, { mutationFn: send, retryDelay: 0 });
    await expect(observer.mutate()).rejects.toMatchObject({ code: 'server_error' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
