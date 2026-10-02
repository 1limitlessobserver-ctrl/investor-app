import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../test/cssRules';
import { Panel } from './Panel';

const CSS = join(import.meta.dirname, 'Panel.module.css');

describe('Panel', () => {
  it('is a section by default, a region when it is named', () => {
    render(
      <Panel aria-labelledby="assumptions">
        <h2 id="assumptions">Assumptions</h2>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Assumptions' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveClass('panel', 'md');
  });

  it('becomes the element it is asked to be and passes attributes through', () => {
    render(
      <ul>
        <Panel as="li" padding="none" glow role="status" className="row">
          Sent to $grace
        </Panel>
      </ul>,
    );
    const item = screen.getByRole('status');
    expect(item.tagName).toBe('LI');
    expect(item).toHaveTextContent('Sent to $grace');
    expect(item).toHaveClass('panel', 'none', 'glow', 'row');
  });

  it('is glass with a hairline edge and a light-catch along the top', () => {
    expect(cssRule(CSS, '.panel')).toMatchObject({
      background: 'var(--glass)',
      border: '1px solid var(--glass-border)',
      'border-radius': 'var(--radius-lg)',
    });
    expect(cssRule(CSS, '.panel::before').background).toMatch(/^linear-gradient\(/);
  });
});
