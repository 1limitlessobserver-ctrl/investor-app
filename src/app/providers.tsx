import { useState, type ReactNode } from 'react';
import { UpdateToast } from '../components/UpdateToast';
import { createQueryClient } from '../queries/client';
import { AppSessionProvider, type AppSessionProviderProps } from '../session/AppSession';

export type AppProvidersProps = Pick<AppSessionProviderProps, 'api' | 'platform'> & {
  children: ReactNode;
};

/**
 * Everything the app runs inside: the query cache and the session (which brings its sheets: the
 * confirmation, the lock setup and the notice), and beside them the service worker's offer of a
 * new version, which needs neither (it reads the cache only to hold Reload while a change is being
 * sent) and stays whatever the app beneath shows, a failure included. `api` and `platform` default
 * to the build's own.
 */
export function AppProviders({ api, platform, children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);
  return (
    <>
      <AppSessionProvider api={api} platform={platform} queryClient={queryClient}>
        {children}
      </AppSessionProvider>
      <UpdateToast queryClient={queryClient} />
    </>
  );
}
