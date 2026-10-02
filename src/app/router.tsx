// The app's routes. Every route sits in RootLayout (the ribbon and the sky), and a route that fails
// shows RouteError in its place; while a screen's code is still loading at launch, LoadingRoute
// stands in. Sign-in is open to all; the rest need a session (RequireSession), and the five main
// destinations share the tab layout. Each later screen adds its route here. An address the app
// does not have goes home: so does /alerts?open=<id>, which a notification's tap opens, until the
// alerts screen arrives.

import { Navigate, type RouteObject } from 'react-router';
import { Amount } from '../components/Amount';
import { useDashboard } from '../queries/portfolio';
import { SignInScreen } from '../screens/signIn/SignInScreen';
import { LoadingRoute, RequireSession, RootLayout, RouteError, TabsLayout } from './layouts';

/**
 * Home's place until its screen arrives: the projected portfolio value, hidden while offline
 * (whether or not it is known by then).
 */
function HomePlaceholder() {
  const dashboard = useDashboard().data;
  return (
    <>
      <h1>Home</h1>
      <p>
        Projected portfolio value: <Amount cents={dashboard?.totals.portfolioValueCents ?? null} />
      </p>
    </>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    HydrateFallback: LoadingRoute,
    children: [
      { path: '/sign-in', element: <SignInScreen /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <TabsLayout />,
            children: [{ index: true, element: <HomePlaceholder /> }],
          },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
