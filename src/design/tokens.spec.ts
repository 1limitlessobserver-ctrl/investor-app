import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themes, type ThemeId } from './themes';

// Read from disk: Vitest hands CSS imports to tests as empty strings, `?raw` included.
const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const TEMPLATE_ACCENT = '#6EA8FF';

/** Every declaration of the rules in tokens.css whose selector list includes `selector`. */
function declarationsFor(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors = '', body = ''] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
    for (const [, name = '', value = ''] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g))
      found[name] = value.trim();
  }
  return found;
}

/** What themes.apply writes for the template accent, as property → value. */
function applied(id: ThemeId): Record<string, string> {
  const root = document.createElement('div');
  themes.apply(id, TEMPLATE_ACCENT, root);
  return Object.fromEntries(
    Array.from(root.style, (name) => [name, root.style.getPropertyValue(name)]),
  );
}

function only(declarations: Record<string, string>, names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(declarations).filter(([name]) => names.includes(name)));
}

describe('tokens.css', () => {
  it('holds the Orbital theme and the template accent under :root', () => {
    const expected = applied('orbital');
    expect(only(declarationsFor(':root'), Object.keys(expected))).toEqual(expected);
    expect(declarationsFor(':root')['--primary']).toBe(
      themes.accent(TEMPLATE_ACCENT, 'orbital').primary,
    );
  });

  it('holds every theme under its own [data-theme] selector', () => {
    for (const id of themes.ids) {
      const expected = applied(id);
      expect(only(declarationsFor(`[data-theme='${id}']`), Object.keys(expected)), id).toEqual(
        expected,
      );
    }
  });

  it('follows each theme’s display face and radius', () => {
    const defaults = declarationsFor('[data-theme]');
    for (const id of themes.ids) {
      const t = themes.tokens(id);
      const block = declarationsFor(`[data-theme='${id}']`);
      expect(block['--font-display'], id).toBe(
        t.display === 'grotesk' ? 'var(--font-ui)' : undefined,
      );
      for (const radius of ['--radius-sm', '--radius-md', '--radius-lg']) {
        if (t.radius === 'soft') expect(block[radius], `${id} ${radius}`).toBeUndefined();
        else
          expect(parseFloat(block[radius] ?? ''), `${id} ${radius}`).toBeLessThan(
            parseFloat(defaults[radius] ?? ''),
          );
      }
    }
  });
});
