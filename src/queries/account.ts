// The account: the brand and the investor, security, sessions and identity verification.
//
// What each action changes, and so invalidates:
//   setNotificationPrefs  me (its notificationPrefs)
//   changePassword        the alerts (the platform raises a password_changed alert)
//   setPin                me (security.pinEnabled)
//   revokeSession         sessions; this device's own: signs out here, which clears the cache
//   enrollTwoFactor       nothing until two-factor is enabled
//   enableTwoFactor       me (security.twoFactorEnabled)
//   disableTwoFactor      me
//   closeAccount          signs out here, which clears the cache
//   submitKyc             kyc, me and the dashboard (kycStatus, the next steps), strategies
//                         (whether the investor may invest)

import { useQuery } from '@tanstack/react-query';
import type { NotificationCategory } from '../api/types';
import { useAppSession } from '../session/AppSession';
import { brandQuery, meQuery } from './identity';
import { queryKey } from './keys';
import { ALERTS, useApiMutation } from './mutation';

export function useBrand() {
  return useQuery(brandQuery(useAppSession().api));
}

export function useMe() {
  return useQuery(meQuery(useAppSession().api));
}

export function useSessions() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'sessions'), queryFn: () => api.sessions() });
}

export function useKyc() {
  const { api, mode } = useAppSession();
  return useQuery({ queryKey: queryKey(mode, 'kyc'), queryFn: () => api.kyc() });
}

export function useSetNotificationPrefs() {
  return useApiMutation(
    (api, prefs: Record<NotificationCategory, boolean>) => api.setNotificationPrefs(prefs),
    () => [['me']],
  );
}

export function useChangePassword() {
  return useApiMutation(
    (api, body: { currentPassword: string; newPassword: string }) => api.changePassword(body),
    () => ALERTS,
  );
}

export function useSetPin() {
  return useApiMutation(
    (api, body: { currentPassword: string; pin: string }) => api.setPin(body),
    () => [['me']],
  );
}

/** Ends one of the investor's sessions; ending this device's own signs out here too. */
export function useRevokeSession() {
  return useApiMutation(
    (api, sessionId: string) => api.revokeSession(sessionId),
    (_, result) => (result.current ? [] : [['sessions']]),
    (result, session) => {
      if (result.current) void session.signOut();
    },
  );
}

export function useEnrollTwoFactor() {
  return useApiMutation(
    (api, body: { currentPassword: string }) => api.enrollTwoFactor(body),
    () => [],
  );
}

export function useEnableTwoFactor() {
  return useApiMutation(
    (api, body: { code: string }) => api.enableTwoFactor(body),
    () => [['me']],
  );
}

export function useDisableTwoFactor() {
  return useApiMutation(
    (api, body: { currentPassword: string }) => api.disableTwoFactor(body),
    () => [['me']],
  );
}

/** Closes the account (every session ends) and signs out here. */
export function useCloseAccount() {
  return useApiMutation(
    (api, body: { currentPassword: string }) => api.closeAccount(body),
    () => [],
    (_, session) => void session.signOut(),
  );
}

export function useSubmitKyc() {
  return useApiMutation(
    (api, submission: Parameters<typeof api.submitKyc>[0]) => api.submitKyc(submission),
    () => [['kyc'], ['me'], ['dashboard'], ['strategies']],
  );
}
