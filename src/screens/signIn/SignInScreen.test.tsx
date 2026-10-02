import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileApiError } from '../../api/MobileApiError';
import { appConfig } from '../../session/appConfig';
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
    // A fresh sign-in offers the device lock first.
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
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

  it('says something went wrong, and reports it, when a sign-in fails unexpectedly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const failure = new TypeError('Failed to fetch');
    vi.spyOn(api, 'login').mockRejectedValue(failure);
    await user.type(await screen.findByLabelText('Email'), 'investor@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
    expect(warn).toHaveBeenCalledWith('[investor-app] signing in:', failure);
  });

  it('shows the platform’s refusal that names no field as the form’s alert', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    vi.spyOn(api, 'login').mockRejectedValue(
      new MobileApiError('invalid_credentials', 401, 'That email and password do not match.'),
    );
    await user.type(await screen.findByLabelText('Email'), 'investor@sample.app');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match.',
    );
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('says near its button why the sample world could not be opened', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    vi.spyOn(api, 'login').mockRejectedValue(
      new MobileApiError('server_error', 503, 'The sample world is resting. Try again soon.'),
    );
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));
    const sample = screen.getByRole('region', { name: 'Look around first' });
    expect(await within(sample).findByRole('alert')).toHaveTextContent(
      'The sample world is resting. Try again soon.',
    );
    expect(within(screen.getByRole('region', { name: 'Sign in' })).queryByRole('alert')).toBeNull();
  });

  it('says the company’s details did not load, and tries again', async () => {
    const user = userEvent.setup();
    let reachable = false;
    renderWithApp({
      route: '/sign-in',
      mode: 'live',
      live: {
        answer: (path) =>
          path === '/brand' && !reachable
            ? Promise.reject(new TypeError('Failed to fetch'))
            : undefined,
      },
    });
    const said = await screen.findByText("The company's details couldn't be loaded.");
    expect(said).toHaveAttribute('role', 'status');
    reachable = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Everest Reserve' }),
    ).toBeInTheDocument();
    expect(screen.queryByText("The company's details couldn't be loaded.")).toBeNull();
  });

  it('links to the platform’s own pages while the company’s details are missing', async () => {
    const platformUrl = appConfig.platformUrl;
    appConfig.platformUrl = 'https://platform.test';
    try {
      renderWithApp({
        route: '/sign-in',
        mode: 'live',
        live: {
          answer: (path) =>
            path === '/brand' ? Promise.reject(new TypeError('Failed to fetch')) : undefined,
        },
      });
      expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
        'href',
        'https://platform.test/forgot-password',
      );
      expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
        'href',
        'https://platform.test/register',
      );
    } finally {
      appConfig.platformUrl = platformUrl;
    }
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
    await user.click(await screen.findByRole('button', { name: 'Not now' })); // the lock offer
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('sends a signed-in visitor on', async () => {
    const { router } = renderWithApp({ route: '/sign-in', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it.each(['https://evil.example/steal', '/.//evil.example', '/%2e//evil.example'])(
    'sends a signed-in visitor home, never on to %s',
    async (next) => {
      const { router } = renderWithApp({
        route: `/sign-in?next=${encodeURIComponent(next)}`,
        signedIn: true,
      });
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/');
    },
  );

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
