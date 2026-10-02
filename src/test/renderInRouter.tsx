import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

/**
 * Renders `ui` inside a memory router that starts at `route` and shows `ui` on every path, so
 * links work and NavLinks know which route is active. `router.state.location` says where a click
 * went.
 */
export function renderInRouter(ui: ReactNode, route = '/') {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [route] });
  return { router, ...render(<RouterProvider router={router} />) };
}
