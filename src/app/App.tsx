import { RouterProvider, type RouterProviderProps } from 'react-router';

/**
 * The app: its routes in `router`, a browser router over `routes` (main.tsx) or a memory router in
 * specs. Render it inside AppProviders. (The router comes from 'react-router' everywhere, never
 * 'react-router/dom': two entries can load two copies, and one's Outlet finds no routes.)
 */
export function App({ router }: { router: RouterProviderProps['router'] }) {
  return <RouterProvider router={router} />;
}
