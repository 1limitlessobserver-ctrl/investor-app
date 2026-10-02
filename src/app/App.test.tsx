import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithApp } from '../test/renderWithApp';

describe('App', () => {
  it('shows a signed-out visitor the sign-in screen', async () => {
    const { router } = renderWithApp({ route: '/' });
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toBe('?next=%2F');
  });
});
