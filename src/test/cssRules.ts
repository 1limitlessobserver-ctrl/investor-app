import { readFileSync } from 'node:fs';

// Vitest hands CSS modules to tests as class names without their rules, so a spec that pins a
// size (a 44 px target, say) reads the stylesheet itself.

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The declarations of every rule whose selector list includes `selector` exactly, the later rule
 * winning, as property → value. Rules inside @media blocks count too.
 */
export function cssRule(path: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, selectors = '', body = ''] of source(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
    for (const [, name = '', value = ''] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      found[name] = value.trim();
    }
  }
  return found;
}

/** Every value the stylesheet gives `property`, in any rule, in file order. */
export function cssValues(path: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g');
  return [...source(path).matchAll(pattern)].map(([, value = '']) => value.trim());
}

/** A length in rem as a number (`2.75rem` → 2.75); NaN for anything else. */
export function rem(value: string | undefined): number {
  const match = /^(-?[\d.]+)rem$/.exec(value ?? '');
  return match ? Number(match[1]) : Number.NaN;
}
