import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { PlatformApi } from '../api/PlatformApi';
import type { Brand, Me, MobileTokens } from '../api/types';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { Button } from '../components/form/Button';
import { StateView } from '../components/StateView';
import { themes, type ThemeId } from '../design/themes';
import { platform as webPlatform } from '../platform';
import type { LockMethod, Platform } from '../platform/types';
import { createQueryClient } from '../queries/client';
import { brandQuery, meQuery } from '../queries/identity';
import { LockSetupSheet } from '../screens/lock/LockSetupSheet';
import { createAppApi } from './appApi';
import { appConfig } from './appConfig';
import { accentFor, themeFor } from './brand';
import {
  createSessionController,
  updateRequiredFor,
  type ApiWiring,
  type ConfirmOptions,
  type SessionController,
  type SessionStatus,
  type Unlocking,
} from './sessionController';
import { createTokenStore } from './tokens';
import styles from './AppSession.module.css';

export type { ApiWiring, ConfirmOptions, SessionEvents, Unlocking } from './sessionController';

/** What every screen knows of the session, through useAppSession(). */
export interface AppSession {
  /** The platform, for the screens' few direct calls; reads and writes go through src/queries. */
  api: PlatformApi;
  mode: PlatformApi['mode'];
  /** The device: secure storage, the lock, notifications, sharing, installing, haptics. */
  platform: Platform;
  status: SessionStatus;
  /** The company's brand, from the device's cache until the platform answers. */
  brand: Brand | null;
  /** The investor, while signed in. */
  me: Me | null;
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  online: boolean;
  /**
   * The lock after five minutes away is on. (A lock set up on the device asks at launch, on "Lock
   * now" and for every confirmation, whatever this says.)
   */
  lockEnabled: boolean;
  /** The lock set up on this device: what unlock() and confirm() ask for. */
  lockMethod: LockMethod | null;
  /** Off asks for a confirmation first; on with no lock set up offers to set one up. */
  setLockEnabled: (on: boolean) => Promise<boolean>;
  signIn: (tokens: MobileTokens) => Promise<void>;
  /** Sample mode: signs in to the sample world. */
  enterSample: () => Promise<void>;
  signOut: () => Promise<void>;
  /** "Lock now": locks whenever a lock is set up, whatever lockEnabled says. */
  lock: () => void;
  /** The lock screen's check: the device prompt (call it inside the tap) or the passcode. */
  unlock: (passcode?: string) => Promise<boolean>;
  unlocking: Unlocking;
  /** Asks before a money action or an account closure: the reason, the amount, the lock. */
  confirm: (reason: string, options?: ConfirmOptions) => Promise<boolean>;
  /** The version the platform needs ('' when it did not say); null when this one will do. */
  updateRequired: string | null;
}

const SessionContext = createContext<AppSession | null>(null);

export function useAppSession(): AppSession {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useAppSession() needs an AppSessionProvider above it.');
  return session;
}

export interface AppSessionProviderProps {
  /**
   * The platform to talk to: an api, or a function that makes it from the session's callbacks and
   * token store (so it can tell the session it signed out). The default is the build's own:
   * the sample world, or the company's platform.
   */
  api?: PlatformApi | ((wiring: ApiWiring) => PlatformApi) | undefined;
  /** The device's adapters; the browser's unless a test passes its own. */
  platform?: Platform | undefined;
  /** The cache; a new one unless given. */
  queryClient?: QueryClient | undefined;
  children: ReactNode;
}

type Setup =
  | { queryClient: QueryClient; controller: SessionController; failure?: never }
  | { queryClient: QueryClient; controller: null; failure: unknown };

/**
 * The session for everything inside it, and the sheets it shows over any screen: the
 * confirmation, the offer to set up a lock and a passing notice. Made once: a later change to its
 * props changes nothing.
 */
export function AppSessionProvider({
  api,
  platform = webPlatform,
  queryClient,
  children,
}: AppSessionProviderProps) {
  const [setup] = useState<Setup>(() => {
    const client = queryClient ?? createQueryClient();
    const makeApi = typeof api === 'function' ? api : api === undefined ? createAppApi : () => api;
    try {
      const controller = createSessionController({
        makeApi,
        platform,
        queryClient: client,
        tokenStore: createTokenStore(platform.storage),
        appVersion: appConfig.appVersion,
      });
      return { queryClient: client, controller };
    } catch (failure) {
      return { queryClient: client, controller: null, failure };
    }
  });
  return (
    <QueryClientProvider client={setup.queryClient}>
      {setup.controller ? (
        <Session controller={setup.controller}>{children}</Session>
      ) : (
        <SetupProblem failure={setup.failure} />
      )}
    </QueryClientProvider>
  );
}

function Session({ controller, children }: { controller: SessionController; children: ReactNode }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.start(), [controller]);
  const { api, platform } = controller;
  const brand = useQuery(brandQuery(api)).data ?? null;
  const signedIn = state.status === 'signed-in';
  const meResult = useQuery({ ...meQuery(api), enabled: signedIn });
  const me = signedIn || state.status === 'locked' ? (meResult.data ?? null) : null;
  const theme = themeFor(state.themeChoice, brand);
  const accent = accentFor(brand, appConfig.accentFallback);
  useLayoutEffect(() => {
    themes.apply(theme, accent);
  }, [theme, accent]);
  const updateRequired = updateRequiredFor(brand, state.upgradeRequired, appConfig.appVersion);

  const session = useMemo<AppSession>(
    () => ({
      api,
      mode: api.mode,
      platform,
      status: state.status,
      brand,
      me,
      theme,
      setTheme: controller.setTheme,
      online: state.online,
      lockEnabled: state.lockChoice ?? state.lockMethod !== null,
      lockMethod: state.lockMethod,
      setLockEnabled: controller.setLockEnabled,
      signIn: controller.signIn,
      enterSample: controller.enterSample,
      signOut: controller.signOut,
      lock: controller.lock,
      unlock: controller.unlock,
      unlocking: state.unlocking,
      confirm: controller.confirm,
      updateRequired,
    }),
    [api, platform, controller, state, brand, me, theme, updateRequired],
  );

  const { confirmation, lockSetup, notice } = state;
  return (
    <SessionContext.Provider value={session}>
      {children}
      <ConfirmSheet
        open={confirmation !== null && lockSetup === null && updateRequired === null}
        reason={confirmation?.reason ?? ''}
        amountCents={confirmation?.amountCents}
        currency={confirmation?.currency}
        method={state.lockMethod}
        needsSetup={confirmation?.offerSetup}
        onSetUpLock={controller.setUpLockForConfirmation}
        busy={confirmation?.busy}
        error={confirmation?.error}
        attemptsLeft={confirmation?.attemptsLeft}
        onConfirm={controller.confirmWith}
        onCancel={controller.cancelConfirmation}
      />
      <LockSetupSheet
        open={lockSetup !== null && updateRequired === null}
        available={lockSetup?.available ?? 'passcode'}
        busy={lockSetup?.busy}
        error={lockSetup?.error}
        onUseDevice={controller.enrolDevice}
        onPasscode={controller.enrolPasscode}
        onNotNow={controller.skipLockSetup}
      />
      <div className={styles.notice} data-shown={notice !== null || undefined}>
        <p role="status" className={styles.message}>
          {notice}
        </p>
        {notice !== null && (
          <Button size="sm" variant="ghost" onClick={controller.dismissNotice}>
            Dismiss
          </Button>
        )}
      </div>
    </SessionContext.Provider>
  );
}

const SETUP_PROBLEM =
  "Its platform address or version can't be used. The company that offers the app can fix this.";

/** The build's platform settings could not be used: nothing can work, so say so plainly. */
function SetupProblem({ failure }: { failure: unknown }) {
  useEffect(() => {
    console.error('The app could not start:', failure);
  }, [failure]);
  return (
    <main className={styles.problem}>
      <StateView kind="error" title="This app isn't set up correctly" detail={SETUP_PROBLEM} />
    </main>
  );
}
