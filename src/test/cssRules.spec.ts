import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cssOrder, cssRule, cssValues, rem } from './cssRules';

const dir = mkdtempSync(join(tmpdir(), 'css-rules-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function sheet(css: string): string {
  const path = join(dir, 'sheet.module.css');
  writeFileSync(path, css);
  return path;
}

const CSS = sheet(`
/* .ghost { min-height: 1rem; } is a comment, not a rule */
.button {
  min-height: 2.75rem;
  padding: var(--space-2) var(--space-5);
}

.sm,
.md {
  min-height: 3rem;
}

.button:focus-visible {
  outline: 2px solid var(--accent-text);
}

@media (max-width: 25rem) {
  .button {
    min-height: 3.25rem;
  }
}
`);

describe('cssRules', () => {
  it('collects a selector’s declarations, later rules and @media blocks winning', () => {
    expect(cssRule(CSS, '.button')).toEqual({
      'min-height': '3.25rem',
      padding: 'var(--space-2) var(--space-5)',
    });
  });

  it('matches a selector inside a selector list, and only whole selectors', () => {
    expect(cssRule(CSS, '.md')).toEqual({ 'min-height': '3rem' });
    expect(cssRule(CSS, '.button:focus')).toEqual({});
  });

  it('ignores commented-out rules', () => {
    expect(cssRule(CSS, '.ghost')).toEqual({});
    expect(cssValues(CSS, 'min-height')).toEqual(['2.75rem', '3rem', '3.25rem']);
  });

  it('gives the place of a selector’s first rule, or -1', () => {
    expect(cssOrder(CSS, '.button')).toBeLessThan(cssOrder(CSS, '.button:focus-visible'));
    expect(cssOrder(CSS, '.sm')).toBe(cssOrder(CSS, '.md'));
    expect(cssOrder(CSS, '.missing')).toBe(-1);
  });

  it('reads rem lengths and nothing else', () => {
    expect(rem('2.75rem')).toBe(2.75);
    expect(rem('2px')).toBeNaN();
    expect(rem(undefined)).toBeNaN();
  });
});
