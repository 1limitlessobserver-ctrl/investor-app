import { readFileSync } from 'node:fs';

// Vitest hands CSS modules to tests as class names without their rules, so a spec that pins a
// size (a 44 px target, say) reads the stylesheet itself.

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every rule as its selectors, its declarations' text and where it starts, in file order. */
function rules(path: string) {
  return [...source(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((s) => s.trim()),
    body: match[2] ?? '',
    at: match.index,
  }));
}

/**
 * The declarations of every rule whose selector list includes `selector` exactly, the later rule
 * winning, as property → value. Rules inside @media blocks count too.
 */
export function cssRule(path: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const { selectors, body } of rules(path)) {
    if (!selectors.includes(selector)) continue;
    for (const [, name = '', value = ''] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      found[name] = value.trim();
    }
  }
  return found;
}

/**
 * Where the first rule naming `selector` exactly starts, or -1: compare two to check which rule
 * comes later and so wins between selectors of equal weight.
 */
export function cssOrder(path: string, selector: string): number {
  return rules(path).find(({ selectors }) => selectors.includes(selector))?.at ?? -1;
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
