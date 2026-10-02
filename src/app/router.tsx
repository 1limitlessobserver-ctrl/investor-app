// The app's routes. Every route sits in RootLayout (the ribbon and the sky), and a route that fails
// shows RouteError in its place; while a screen's code is still loading at launch, LoadingRoute
// stands in. Sign-in is open to all; the rest need a session (RequireSession), and the five main
// destinations share the tab layout. Each later screen adds its route here. An address the app
// does not have goes home.

import { Navigate, type RouteObject } from 'react-router';
import { SignInScreen } from '../screens/signIn/SignInScreen';
import { LoadingRoute, RequireSession, RootLayout, RouteError, TabsLayout } from './layouts';

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
            // Home's place until its screen arrives.
            children: [{ index: true, element: <h1>Home</h1> }],
          },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
