import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { SpaceBackdrop } from './SpaceBackdrop';

describe('SpaceBackdrop', () => {
  beforeEach(() => {
    stubMatchMedia(true); // a still frame: no animation loop to manage here
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is a decorative layer with no stars unless asked', () => {
    const { container } = render(<SpaceBackdrop />);
    const layer = container.firstElementChild;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).not.toHaveAttribute('data-space');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('adds the starfield and the planet horizon for the space themes', () => {
    const { container } = render(<SpaceBackdrop starfield />);
    expect(container.firstElementChild).toHaveAttribute('data-space');
    expect(container.querySelector('canvas[data-starfield]')).toBeInTheDocument();
  });
});
