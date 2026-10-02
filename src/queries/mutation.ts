// How every mutation hook is made: it sends through the session's api and, once the platform has
// answered, invalidates exactly the queries the action changed (the table is in each area's file),
// so the screens that show them fetch them again. The cache never sends a mutation twice, and it
// waits while the device is offline (src/queries/client.ts).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformApi } from '../api/PlatformApi';
import { useAppSession, type AppSession } from '../session/AppSession';
import type { QueryName } from './keys';

/** A query an action changes: every one of the name, or the one of these arguments. */
export type Changed = readonly [QueryName, ...(string | number)[]];

/**
 * Where the alerts the platform raises on the investor's own actions show (a deposit request, a
 * top-up, a transfer sent, a position opened, a beneficiary changed, the password changed): the
 * alerts list, and the unread counts on /me and the dashboard.
 */
export const ALERTS: readonly Changed[] = [['notifications'], ['me'], ['dashboard']];

export function useApiMutation<TVariables, TResult>(
  send: (api: PlatformApi, variables: TVariables) => Promise<TResult>,
  changes: (variables: TVariables, result: TResult) => readonly Changed[],
  /** What the session does next, once the platform has answered (sign out, say). */
  after?: (result: TResult, session: AppSession) => void,
) {
  const session = useAppSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => send(session.api, variables),
    onSuccess: (result, variables) => {
      const keys = new Set(changes(variables, result).map((key) => JSON.stringify(key)));
      for (const key of keys) {
        const changed = JSON.parse(key) as Changed;
        void queryClient.invalidateQueries({ queryKey: [session.mode, ...changed] });
      }
      after?.(result, session);
    },
  });
}
