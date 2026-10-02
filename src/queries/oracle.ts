// The Oracle. A question changes nothing the app shows elsewhere: the conversation lives on its
// screen, so asking invalidates nothing.

import { useApiMutation } from './mutation';

export function useOracleAsk() {
  return useApiMutation(
    (api, body: { conversationId?: string; question: string }) => api.oracleAsk(body),
    () => [],
  );
}
