import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { cssOrder, cssRule } from '../../test/cssRules';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('forwards its ref and keeps line breaks', async () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="Message" rows={4} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(ref.current).toBe(textarea);
    await userEvent.setup().type(textarea, 'First line{Enter}Second line');
    expect(textarea).toHaveValue('First line\nSecond line');
  });

  it('is marked invalid by an error on its own, outside a Field', () => {
    render(<Textarea aria-label="Reply" error />);
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a real outline on keyboard focus, and focus wins over hover and the error', () => {
    const css = join(import.meta.dirname, 'Textarea.module.css');
    expect(cssRule(css, '.textarea:focus-visible')).toMatchObject({
      outline: '2px solid var(--accent-text)',
      'outline-offset': '2px',
      'border-color': 'var(--accent-text)',
    });
    expect(cssOrder(css, '.textarea:hover')).toBeGreaterThan(-1);
    expect(cssOrder(css, '.textarea:hover')).toBeLessThan(
      cssOrder(css, ".textarea[aria-invalid='true']"),
    );
    expect(cssOrder(css, ".textarea[aria-invalid='true']")).toBeLessThan(
      cssOrder(css, '.textarea:focus-visible'),
    );
  });
});
