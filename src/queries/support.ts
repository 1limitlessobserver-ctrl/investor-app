// Support: the investor's tickets and their threads.
//
// What each action changes, and so invalidates:
//   openTicket   every page of tickets (the new one comes first)
//   replyTicket  that ticket's thread, and every page of tickets (its status and its place)

import { useQuery } from '@tanstack/react-query';
import { useAppSession } from '../session/AppSession';
import { queryKey } from './keys';
import { useApiMutation } from './mutation';

/** One page of tickets, 20 to a page, newest activity first. */
export function useTickets(page = 1) {
  const { api, mode } = useAppSession();
  return useQuery({
    queryKey: queryKey(mode, 'tickets', page),
    queryFn: () => api.supportTickets(page),
  });
}

export function useTicket(id: string) {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'ticket', id), queryFn: () => api.ticket(id) });
}

export function useOpenTicket() {
  return useApiMutation(
    (api, body: { subject: string; message: string }) => api.openTicket(body),
    () => [['tickets']],
  );
}

export function useReplyTicket() {
  return useApiMutation(
    (api, body: { id: string; message: string }) => api.replyTicket(body),
    (body) => [['ticket', body.id], ['tickets']],
  );
}
