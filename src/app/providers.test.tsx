import { useMutation } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/** Whether the mocked registration says a new version waits. */
const offer = vi.hoisted(() => ({ waiting: true }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [offer.waiting, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: () => Promise.resolve(),
  }),
}));
import { createSampleApi } from '../api/createSampleApi';
import { fakePlatform } from '../test/fakePlatform';
import { AppProviders } from './providers';

function renderProviders(children: ReactNode) {
  return render(
    <AppProviders api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
      {children}
    </AppProviders>,
  );
}

describe('AppProviders', () => {
  it('offers a waiting version once, over whatever the app shows', () => {
    renderProviders(<p>A screen</p>);
    expect(screen.getAllByRole('status', { name: 'Update' })).toHaveLength(1);
    expect(screen.getByRole('status', { name: 'Update' })).toHaveTextContent('Update available');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('holds the offer’s Reload while the app is sending a change', async () => {
    let sent!: () => void;
    const gone = new Promise<void>((resolve) => (sent = resolve));
    function Send() {
      const change = useMutation({ mutationFn: () => gone });
      return (
        <button type="button" onClick={() => change.mutate()}>
          Send
        </button>
      );
    }
    renderProviders(<Send />);
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(reload).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(reload).toBeDisabled());
    act(() => sent());
    await waitFor(() => expect(reload).toBeEnabled());
  });

  it('keeps the offer when the app beneath cannot render', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    function Broken(): never {
      throw new Error('a screen that cannot render');
    }
    renderProviders(<Broken />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('status', { name: 'Update' })).toHaveTextContent('Update available');
    // The failure's own Reload, and the offer's, which takes the new version.
    expect(screen.getAllByRole('button', { name: 'Reload' })).toHaveLength(2);
    logged.mockRestore();
  });
});
