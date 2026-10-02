import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '../../test/renderWithApp';

describe('SignInScreen', () => {
  it('offers sample exploration and the two-factor hint in sample mode', async () => {
    renderWithApp({ route: '/sign-in' });
    expect(
      await screen.findByRole('button', { name: 'Explore with sample data' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/add \+2fa to try the two-factor step/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('shows the platform message on a wrong two-factor code', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/sign-in' });
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Six-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });

  it('signs in once the code is right, and goes where the visitor was going', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp({ route: '/sign-in?next=%2F%3Ffrom%3Dlink' });
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('Six-digit code');
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('alert');
    await user.clear(code);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?from=link');
  });

  it('takes a backup code instead of the six digits', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const twoFactor = vi.spyOn(api, 'loginTwoFactor');
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), 'SMPL-0001');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(twoFactor).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SMPL-0001', useBackup: true }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });

  it('puts the platform’s word on the field it refused', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/sign-in' });
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('explores the sample world', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp({ route: '/sign-in' });
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('sends a signed-in visitor on', async () => {
    const { router } = renderWithApp({ route: '/sign-in', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('links to the company’s own pages for a new account or a forgotten password', async () => {
    renderWithApp({ route: '/sign-in' });
    const forgot = await screen.findByRole('link', { name: 'Forgot password?' });
    expect(forgot).toHaveAttribute('href', 'https://example.com/forgot-password');
    expect(forgot).toHaveAttribute('target', '_blank');
    expect(forgot).toHaveAccessibleDescription('Opens in a new tab');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      'https://example.com/register',
    );
  });
});
