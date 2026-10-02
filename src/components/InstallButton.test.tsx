import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallButton } from './InstallButton';
import type { InstallAdapter } from '../platform/types';

const adapter = (o: Partial<InstallAdapter>): InstallAdapter => ({
  canPrompt: () => false,
  prompt: () => Promise.resolve('unavailable'),
  isInstalled: () => false,
  hint: () => null,
  subscribe: () => () => {},
  ...o,
});

describe('InstallButton', () => {
  it('shows the button when a prompt is available', () => {
    render(<InstallButton placement="sign-in" install={adapter({ canPrompt: () => true })} />);
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
  });
  it('shows the Safari hint instead of a button', () => {
    render(<InstallButton placement="sign-in" install={adapter({ hint: () => 'safari-ios' })} />);
    expect(screen.getByText(/Share → Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders nothing once installed or when nothing applies', () => {
    const { container } = render(
      <InstallButton
        placement="profile"
        install={adapter({ isInstalled: () => true, canPrompt: () => true })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/** An adapter whose answers the test changes, telling its listeners as the browser's would. */
function changing(initial: Partial<InstallAdapter>) {
  let answers = { ...initial };
  const listeners = new Set<() => void>();
  const install = adapter({
    canPrompt: () => answers.canPrompt?.() ?? false,
    isInstalled: () => answers.isInstalled?.() ?? false,
    hint: () => answers.hint?.() ?? null,
    prompt: (...args) => answers.prompt?.(...args) ?? Promise.resolve('unavailable'),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    install,
    listeners,
    change(next: Partial<InstallAdapter>) {
      answers = { ...answers, ...next };
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

describe('InstallButton, as the browser changes its answers', () => {
  it('appears when the browser offers its prompt, and goes once installed', () => {
    const device = changing({});
    const { container } = render(<InstallButton placement="sign-in" install={device.install} />);
    expect(container).toBeEmptyDOMElement();
    device.change({ canPrompt: () => true });
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
    device.change({ isInstalled: () => true });
    expect(container).toBeEmptyDOMElement();
  });

  it('stops listening once it is gone', () => {
    const device = changing({});
    const { unmount } = render(<InstallButton placement="sign-in" install={device.install} />);
    expect(device.listeners.size).toBe(1);
    unmount();
    expect(device.listeners.size).toBe(0);
  });

  it('shows the browser’s prompt from the tap, and goes once the investor accepts', async () => {
    const prompt = vi.fn(() => Promise.resolve('accepted' as const));
    // The prompt stays on offer as far as the adapter says: the button goes all the same.
    const device = changing({ canPrompt: () => true, prompt });
    const { container } = render(<InstallButton placement="profile" install={device.install} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('stays while the prompt is still on offer after the investor dismisses it', async () => {
    const prompt = vi.fn(() => Promise.resolve('dismissed' as const));
    const device = changing({ canPrompt: () => true, prompt });
    render(<InstallButton placement="sign-in" install={device.install} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
  });

  it('shows the steps for Safari on a Mac', () => {
    render(<InstallButton placement="sign-in" install={adapter({ hint: () => 'safari-mac' })} />);
    expect(screen.getByText(/File → Add to Dock/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the prompt where both a prompt and a hint would apply', () => {
    render(
      <InstallButton
        placement="sign-in"
        install={adapter({ canPrompt: () => true, hint: () => 'safari-mac' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument();
    expect(screen.queryByText(/Add to Dock/)).toBeNull();
  });
});
