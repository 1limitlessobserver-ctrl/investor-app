import { useEffect, useRef } from 'react';
import { useMotion } from '../design/useMotion';
import styles from './Starfield.module.css';

const TAU = Math.PI * 2;
/** Fraction of the width a nearest star drifts per second: a full crossing takes minutes. */
const DRIFT = 0.0035;
/** One star in eight takes the accent colour. */
const ACCENT_EVERY = 8;
/** The longest step between frames counted, so a stalled tab does not jump the field. */
const MAX_STEP_SECONDS = 0.1;

interface Star {
  /** Position as a fraction of the width and height. */
  x: number;
  y: number;
  /** Radius in CSS pixels. */
  radius: number;
  /** 0.25 (far, dim, slow) to 1 (near, bright, faster). */
  depth: number;
  phase: number;
  /** Twinkle speed in radians a second. */
  speed: number;
  accent: boolean;
}

/** A small seeded generator (mulberry32), so every mount draws the same sky. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStars(count: number): Star[] {
  const random = seeded(0x5eed);
  return Array.from({ length: count }, (_, index) => {
    const depth = 0.25 + random() * 0.75;
    return {
      x: random(),
      y: random(),
      radius: 0.35 + depth * (0.55 + random() * 0.5),
      depth,
      phase: random() * TAU,
      speed: 0.35 + random() * 1.1,
      accent: index % ACCENT_EVERY === 0,
    };
  });
}

/** Draws the field onto one canvas; every allocation happens here, none per frame. */
function createScene(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, count: number) {
  const stars = createStars(count);
  let width = 0;
  let height = 0;
  let starColour = 'transparent';
  let accentColour = 'transparent';

  function drawPass(time: number, accent: boolean) {
    context.fillStyle = accent ? accentColour : starColour;
    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index];
      if (!star || star.accent !== accent) continue;
      const drifted = star.x + time * DRIFT * star.depth;
      const twinkle = 0.62 + 0.38 * Math.sin(time * star.speed + star.phase);
      context.globalAlpha = (0.25 + 0.65 * star.depth) * twinkle;
      context.beginPath();
      context.arc((drifted - Math.floor(drifted)) * width, star.y * height, star.radius, 0, TAU);
      context.fill();
    }
  }

  return {
    /** Matches the canvas to its box at the device's pixel ratio. */
    resize() {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
    /** The theme's foreground and accent, read again whenever the theme changes. */
    readColours() {
      const style = getComputedStyle(canvas);
      starColour = style.getPropertyValue('--foreground').trim() || 'transparent';
      accentColour = style.getPropertyValue('--accent-text').trim() || starColour;
    },
    /** The sky `time` seconds into its drift. */
    draw(time: number) {
      context.clearRect(0, 0, width, height);
      drawPass(time, false);
      drawPass(time, true);
      context.globalAlpha = 1;
    },
  };
}

export interface StarfieldProps {
  /** How many stars; about 120 fill a phone without crowding a desktop. */
  count?: number;
  className?: string | undefined;
}

/**
 * A faint living starfield on a canvas that fills its container: stars drift slowly and
 * twinkle. One animation frame loop runs while useMotion allows it; under reduced motion or
 * while the app is hidden it holds a still frame. It draws at the device's pixel ratio,
 * follows the container's size and the theme's colours, and allocates nothing per frame.
 * `data-starfield` marks the canvas for the motion audit.
 */
export function Starfield({ count = 120, className }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null);
  // Seconds of drift so far; it survives pauses, so the sky resumes where it stopped.
  const elapsed = useRef(0);
  const { animate } = useMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const scene = createScene(canvas, context, count);
    sceneRef.current = scene;
    scene.resize();
    scene.readColours();
    scene.draw(elapsed.current);

    const redraw = () => scene.draw(elapsed.current);
    const onResize = () => {
      scene.resize();
      redraw();
    };
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (sizes) sizes.observe(canvas);
    else window.addEventListener('resize', onResize);
    const theme = new MutationObserver(() => {
      scene.readColours();
      redraw();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    });

    return () => {
      sizes?.disconnect();
      window.removeEventListener('resize', onResize);
      theme.disconnect();
      sceneRef.current = null;
    };
  }, [count]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!animate || !scene) return;
    let frame = 0;
    let last = -1;
    const tick = (now: number) => {
      if (last >= 0) elapsed.current += Math.min((now - last) / 1000, MAX_STEP_SECONDS);
      last = now;
      scene.draw(elapsed.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, count]);

  return (
    <canvas
      ref={canvasRef}
      className={[styles.canvas, className].filter(Boolean).join(' ')}
      data-starfield
      aria-hidden="true"
    />
  );
}
