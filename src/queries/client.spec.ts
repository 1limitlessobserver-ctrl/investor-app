import { MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query';
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

  it('sends a mutation at once even offline, where it fails: never later', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    // Offline, the request fails at once: a money action is never queued for the reconnect.
    const send = vi.fn(() => Promise.reject(MobileApiError.network()));
    const observer = new MutationObserver(client, { mutationFn: send });
    await expect(observer.mutate()).rejects.toMatchObject({ code: 'network' });
    expect(send).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('holds a query while offline, and fetches it once back online', async () => {
    const client = createQueryClient();
    client.mount(); // as QueryClientProvider does: it hears the network come back
    onlineManager.setOnline(false);
    const fetch = vi.fn(() => Promise.resolve('fresh'));
    const observer = new QueryObserver(client, { queryKey: ['sample', 'x'], queryFn: fetch });
    const stop = observer.subscribe(() => {});
    expect(observer.getCurrentResult().fetchStatus).toBe('paused');
    expect(fetch).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('fresh'));
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();
    client.unmount();
  });

  it('never sends a mutation twice, not even after a server failure', async () => {
    const client = createQueryClient();
    const send = vi.fn(() => Promise.reject(error('server_error', 500)));
    const observer = new MutationObserver(client, { mutationFn: send, retryDelay: 0 });
    await expect(observer.mutate()).rejects.toMatchObject({ code: 'server_error' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
