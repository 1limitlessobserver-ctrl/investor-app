import { Navigate, Outlet, useLocation } from 'react-router';
import { AppShell } from '../components/AppShell';
import { LockScreen } from '../components/LockScreen';
import { SampleRibbon } from '../components/SampleRibbon';
import { SpaceBackdrop } from '../components/SpaceBackdrop';
import { StateView } from '../components/StateView';
import { UpdateRequired } from '../components/UpdateRequired';
import { themes } from '../design/themes';
import { useAlerts } from '../queries/alerts';
import { useAppSession } from '../session/AppSession';
import { signInPath } from './nextPath';
import styles from './layouts.module.css';

/**
 * Around every route: the sample ribbon (sample mode) first in the page, the sky behind it all
 * (kept still under the lock and the update screen, which cover it), then the route.
 */
export function RootLayout() {
  const { mode, theme, status, updateRequired } = useAppSession();
  const covered = status === 'locked' || (status === 'signed-in' && updateRequired !== null);
  return (
    <>
      {mode === 'sample' && <SampleRibbon />}
      <SpaceBackdrop starfield={themes.tokens(theme).starfield && !covered} />
      <Outlet />
    </>
  );
}

/** The page while the session starts. */
export function StartingUp() {
  return (
    <main className={styles.starting}>
      <StateView kind="loading" className={styles.loading} />
    </main>
  );
}

/**
 * A route that failed to render, in place of the router's own error page: a calm message and a
 * reload. The router still reports the error to the console.
 */
export function RouteError() {
  const { mode } = useAppSession();
  return (
    <>
      {mode === 'sample' && <SampleRibbon />}
      <main className={styles.starting}>
        <StateView
          kind="error"
          title="Something went wrong"
          detail="This screen couldn't be shown. Reload the app to try again."
          action={{ label: 'Reload', onClick: () => window.location.reload() }}
        />
      </main>
    </>
  );
}

/**
 * The routes that need a session. A signed-out visitor goes to sign-in, and comes back after. An
 * app the platform no longer serves shows the update screen instead (sign-out still works). A
 * locked app keeps its screen beneath the lock, which covers it, takes focus and hides it from
 * assistive technology, and gives focus back once unlocked. A locked app with no lock left to open
 * it shows nothing of the app while the session ends (the session ends it here).
 */
export function RequireSession() {
  const session = useAppSession();
  const { status, updateRequired, brand, lockMethod, unlocking } = session;
  const location = useLocation();
  if (status === 'loading') return <StartingUp />;
  if (status === 'signed-out') return <Navigate to={signInPath(location)} replace />;
  if (updateRequired !== null) {
    return (
      <UpdateRequired
        brand={brand}
        minVersion={updateRequired}
        onSignOut={() => void session.signOut()}
      />
    );
  }
  if (status === 'locked') {
    if (lockMethod === null) return <StartingUp />;
    return (
      <>
        <Outlet />
        <LockScreen
          method={lockMethod}
          brand={brand}
          busy={unlocking.busy}
          error={unlocking.error}
          attemptsLeft={unlocking.attemptsLeft}
          onUnlock={() => void session.unlock()}
          onPasscode={(code) => void session.unlock(code)}
          onSignOut={() => void session.signOut()}
        />
      </>
    );
  }
  return <Outlet />;
}

/** The five main destinations' layout: the shell with its header, banners and tab bar or rail. */
export function TabsLayout() {
  const { brand, online } = useAppSession();
  const unread = useAlerts().data?.unreadCount ?? 0;
  return (
    <AppShell brand={brand} unread={unread} online={online}>
      <Outlet />
    </AppShell>
  );
}
