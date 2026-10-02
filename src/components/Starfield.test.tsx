import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/stubMatchMedia';
import { Starfield } from './Starfield';

/** A 2D context that records what is drawn; jsdom has none. */
function fakeContext() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn<(x: number, y: number, radius: number, start: number, end: number) => void>(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
}

let context: ReturnType<typeof fakeContext>;
/** The frames the starfield has asked for and not cancelled, by id. */
let pending: Map<number, FrameRequestCallback>;
let lastFrameId: number;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Runs the one frame the starfield is waiting for, at `time` ms. */
function runFrame(time: number) {
  expect(pending.size).toBe(1);
  const [id, callback] = [...pending][0] ?? [];
  if (id === undefined || callback === undefined) return;
  pending.delete(id);
  callback(time);
}

describe('Starfield', () => {
  beforeEach(() => {
    context = fakeContext();
    pending = new Map();
    lastFrameId = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 400, height: 300 }),
    );
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        lastFrameId += 1;
        pending.set(lastFrameId, callback);
        return lastFrameId;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => pending.delete(id)),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('draws one still frame of about 120 stars under reduced motion, at the pixel ratio', () => {
    stubMatchMedia(true);
    const { container } = render(<Starfield />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('data-starfield');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas?.width).toBe(800);
    expect(canvas?.height).toBe(600);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.arc).toHaveBeenCalledTimes(120);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('redraws sharply when the pixel ratio changes (zoom, another screen)', () => {
    const media = stubMatchMedia(true);
    const { container } = render(<Starfield />);
    const canvas = container.querySelector('canvas');
    expect(media.matchMedia).toHaveBeenCalledWith('(resolution: 2dppx)');
    vi.stubGlobal('devicePixelRatio', 3);
    media.change(true);
    expect(canvas?.width).toBe(1200);
    expect(canvas?.height).toBe(900);
    expect(context.setTransform).toHaveBeenLastCalledWith(3, 0, 0, 3, 0, 0);
  });

  it('draws at most about 30 frames a second', () => {
    stubMatchMedia(false);
    render(<Starfield count={10} />);
    context.arc.mockClear();
    runFrame(1000);
    expect(context.arc).toHaveBeenCalledTimes(10);
    runFrame(1016);
    expect(context.arc).toHaveBeenCalledTimes(10);
    runFrame(1033);
    expect(context.arc).toHaveBeenCalledTimes(20);
    expect(pending.size).toBe(1);
  });

  it('places the same stars every time it mounts', () => {
    stubMatchMedia(true);
    const { unmount } = render(<Starfield count={20} />);
    const first = context.arc.mock.calls.map((call) => call.slice(0, 3));
    unmount();
    context.arc.mockClear();
    render(<Starfield count={20} />);
    expect(context.arc.mock.calls.map((call) => call.slice(0, 3))).toEqual(first);
  });

  it('runs a single animation loop and pauses it while the app is hidden', () => {
    stubMatchMedia(false);
    render(<Starfield />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    context.arc.mockClear();
    runFrame(1000);
    runFrame(1040);
    expect(context.arc).toHaveBeenCalledTimes(240);
    expect(pending.size).toBe(1);

    setVisibility('hidden');
    expect(pending.size).toBe(0);

    setVisibility('visible');
    expect(pending.size).toBe(1);
  });

  it('moves the stars only while it animates', () => {
    stubMatchMedia(false);
    render(<Starfield count={10} />);
    runFrame(0);
    const before = context.arc.mock.calls.slice(-10).map((call) => call[0]);
    runFrame(4000);
    const after = context.arc.mock.calls.slice(-10).map((call) => call[0]);
    expect(after).not.toEqual(before);
  });

  it('stays blank and quiet where there is no 2D context', () => {
    stubMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<Starfield />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
