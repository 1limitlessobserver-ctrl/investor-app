import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createSampleApi } from '../api/createSampleApi';
import { AppSessionProvider } from '../session/AppSession';
import { fakePlatform } from '../test/fakePlatform';
import { Amount } from './Amount';

/** Renders `ui` in a session over the sample world, as every screen is. */
function inSession(ui: ReactNode) {
  return render(
    <AppSessionProvider api={createSampleApi({ latencyMs: 0 })} platform={fakePlatform()}>
      {ui}
    </AppSessionProvider>,
  );
}

/** The device goes off or back on line, as the browser tells it. */
function network(online: boolean) {
  act(() => {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

const amount = () => document.querySelector('[data-amount]');

describe('Amount', () => {
  it('writes the cents as money while online', () => {
    inSession(<Amount cents={123456} />);
    expect(amount()).toHaveTextContent('$1,234.56');
    expect(screen.queryByRole('img', { name: 'Hidden while offline' })).toBeNull();
  });

  it('writes them in the currency given', () => {
    inSession(<Amount cents={5000} currency="EUR" />);
    expect(amount()).toHaveTextContent('€50.00');
  });

  it('hides the figure while offline, and says why', async () => {
    inSession(<Amount cents={123456} />);
    network(false);
    await waitFor(() => expect(amount()).toHaveTextContent('•••'));
    expect(amount()).not.toHaveTextContent('1,234');
    expect(screen.getByRole('img', { name: 'Hidden while offline' })).toBe(amount());
  });

  it('shows the figure again once the device is back online', async () => {
    inSession(<Amount cents={123456} />);
    network(false);
    await waitFor(() => expect(amount()).toHaveTextContent('•••'));
    network(true);
    expect(amount()).toHaveTextContent('$1,234.56');
  });

  it('holds a dash until the figure is known, and hides it all the same offline', async () => {
    inSession(<Amount cents={null} />);
    expect(amount()).toHaveTextContent('—');
    expect(amount()).toHaveAttribute('aria-hidden', 'true');
    network(false);
    await waitFor(() => expect(amount()).toHaveTextContent('•••'));
  });

  it('opens hidden on a device that starts offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    inSession(<Amount cents={123456} />);
    expect(amount()).toHaveTextContent('•••');
  });
});
