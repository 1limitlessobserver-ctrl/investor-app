import { useState, type ReactNode } from 'react';
import { createQueryClient } from '../queries/client';
import { AppSessionProvider, type AppSessionProviderProps } from '../session/AppSession';

export type AppProvidersProps = Pick<AppSessionProviderProps, 'api' | 'platform'> & {
  children: ReactNode;
};

/**
 * Everything the app runs inside: the query cache and the session (which brings its sheets: the
 * confirmation, the lock setup and the notice). `api` and `platform` default to the build's own.
 */
export function AppProviders({ api, platform, children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppSessionProvider api={api} platform={platform} queryClient={queryClient}>
      {children}
    </AppSessionProvider>
  );
}
