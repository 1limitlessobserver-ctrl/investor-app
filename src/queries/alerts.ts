// Alerts: the investor's notifications.
//
// What each action changes, and so invalidates:
//   markRead  the alerts (the read flags, and the unread counts on /me and the dashboard)

import { useQuery } from '@tanstack/react-query';
import { useAppSession } from '../session/AppSession';
import { queryKey } from './keys';
import { ALERTS, useApiMutation } from './mutation';

/** The newest alerts and the number unread: the header's badge reads `unreadCount`. */
export function useAlerts() {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'notifications'),
    queryFn: () => api.notifications(),
  });
}

/** Marks one alert read, by its id, or every alert when given none. */
export function useMarkRead() {
  return useApiMutation(
    (api, id: string | undefined) => api.markRead(id),
    () => ALERTS,
  );
}
