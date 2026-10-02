// The app's query client: the memory cache every screen reads the platform through (nothing is
// kept beyond the session: sign-out clears it). Queries and mutations wait while the device is
// offline (networkMode 'online', fed by the session's online state). A failed query is tried
// again only where another try could answer differently; a mutation is never sent twice by the
// cache, since a money action that timed out may still have gone through.

import { QueryClient } from '@tanstack/react-query';
import { MobileApiError } from '../api/MobileApiError';

/**
 * Up to two more tries, except for an answer from the platform below 500 (it would answer the
 * same) and a request the client gave up on (`timeout`: it may have been carried out).
 */
export function retryQuery(failureCount: number, error: unknown): boolean {
  return (
    failureCount < 2 &&
    !(MobileApiError.is(error) && (error.status < 500 || error.code === 'timeout'))
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'online',
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: retryQuery,
      },
      mutations: { retry: 0, networkMode: 'online' },
    },
  });
}
