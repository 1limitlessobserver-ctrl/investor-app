import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { join } from 'node:path';
import { MobileApiError } from '../../api/MobileApiError';
import { appConfig } from '../../session/appConfig';
import { cssRule } from '../../test/cssRules';
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

  it('signs in with an email and password alone, where no second step is asked', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const login = vi.spyOn(api, 'login');
    await user.type(await screen.findByLabelText('Email'), '  investor@sample.app ');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Not now' })); // the lock offer
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    // The email goes without the spaces around it (an email field drops them), the password as is.
    expect(login).toHaveBeenCalledWith({ email: 'investor@sample.app', password: 'anything' });
  });

  it.each([
    ['an email', '', 'anything', 'Enter your email.'],
    ['a password', 'investor@sample.app', '', 'Enter your password.'],
  ])('asks for %s before asking the platform', async (_, email, password, asked) => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const login = vi.spyOn(api, 'login');
    if (email !== '') await user.type(await screen.findByLabelText('Email'), email);
    if (password !== '') await user.type(await screen.findByLabelText('Password'), password);
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(asked);
    expect(login).not.toHaveBeenCalled();
  });

  it('puts focus in the code box, and sends the six digits without spaces', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const twoFactor = vi.spyOn(api, 'loginTwoFactor');
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('Six-digit code');
    expect(code).toHaveFocus();
    fireEvent.change(code, { target: { value: '123 456' } }); // pasted with a space
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(twoFactor).toHaveBeenCalledWith(expect.objectContaining({ code: '123456' })),
    );
  });

  it('goes back from the code to the password', async () => {
    const user = userEvent.setup();
    renderWithApp({ route: '/sign-in' });
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Six-digit code');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Six-digit code')).toBeNull();
  });

  it('takes a backup code instead of the six digits', async () => {
    const user = userEvent.setup();
    const { api } = renderWithApp({ route: '/sign-in' });
    const twoFactor = vi.spyOn(api, 'loginTwoFactor');
    await user.type(await screen.findByLabelText('Email'), 'investor+2fa@sample.app');
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), '  SMPL-0001 '); // spaces around it
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

  /** The sign-in screen's header: its title's. */
  async function header() {
    const title = await screen.findByRole('heading', { level: 1 });
    const found = title.closest('header');
    if (found === null) throw new Error('The title is not in a header.');
    return found;
  }

  /** The screen's status line for the company's details (found by its place: CSS classes). */
  function statusLine() {
    const line = document.querySelector('.unbranded > [role="status"]');
    if (!(line instanceof HTMLElement)) throw new Error('The screen has no status line.');
    return line;
  }

  it('keeps its status line out of the header, empty while the details are in', async () => {
    renderWithApp({ route: '/sign-in' });
    const top = await header();
    expect(statusLine()).toBeEmptyDOMElement();
    expect(top.contains(statusLine())).toBe(false);
  });

  it('keeps one status line from the loading view to the form, and fills it there', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    renderWithApp({
      route: '/sign-in',
      mode: 'live',
      live: {
        answer: (path) =>
          path === '/brand'
            ? held.then(() => Promise.reject(new TypeError('Failed to fetch')))
            : undefined,
      },
    });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    const line = statusLine(); // in the page with the loading view, empty
    expect(line).toBeEmptyDOMElement();
    release(); // the company's details fail to load
    await waitFor(() =>
      expect(line).toHaveTextContent("The company's details couldn't be loaded."),
    );
    expect(statusLine()).toBe(line);
    expect(await header()).toBeInTheDocument(); // the form is up, around the same line
  });

  it('fills its status line once the line is in the page, so it is announced', async () => {
    const filled: string[] = []; // text put into a status line already in the page
    const watch = new MutationObserver((records) => {
      for (const { target, addedNodes } of records) {
        const line = target instanceof Element && target.getAttribute('role') === 'status';
        if (line && addedNodes.length > 0) filled.push(target.textContent ?? '');
      }
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderWithApp({
      route: '/sign-in',
      mode: 'live',
      live: {
        answer: (path) =>
          path === '/brand' ? Promise.reject(new TypeError('Failed to fetch')) : undefined,
      },
    });
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent("The company's details couldn't be loaded."),
    );
    await waitFor(() => expect(filled).toContain("The company's details couldn't be loaded."));
    watch.disconnect();
  });

  it('adds no gap to a branded header: the status line is a row of the screen', () => {
    const css = join(import.meta.dirname, 'SignInScreen.module.css');
    const page = cssRule(css, '.screen');
    expect(page['grid-template-rows']).toBe('auto 1fr');
    for (const gap of ['gap', 'row-gap', 'grid-gap']) expect(page[gap], gap).toBeUndefined();
    expect(Object.keys(cssRule(css, '.unbranded')).filter((p) => p.startsWith('margin'))).toEqual(
      [],
    );
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
    expect(statusLine()).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
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
    expect(forgot).toHaveAttribute('rel', 'noopener noreferrer');
    expect(forgot).toHaveAccessibleDescription('Opens in a new tab');
    const register = screen.getByRole('link', { name: 'Create account' });
    expect(register).toHaveAttribute('href', 'https://example.com/register');
    expect(register).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
