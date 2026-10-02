import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssOrder, cssRule, rem } from '../../test/cssRules';
import { Input } from './Input';

describe('Input', () => {
  it('forwards its ref and native attributes, and reports what is typed', async () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <Input ref={ref} aria-label="Recipient" placeholder="$tag or email" onChange={onChange} />,
    );
    const input = screen.getByRole('textbox', { name: 'Recipient' });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('placeholder', '$tag or email');
    await userEvent.setup().type(input, '$grace');
    expect(input).toHaveValue('$grace');
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('is marked invalid by an error on its own, outside a Field', () => {
    const { rerender } = render(<Input aria-label="Amount" error="Enter an amount." />);
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('aria-invalid', 'true');
    rerender(<Input aria-label="Amount" error={null} />);
    expect(screen.getByRole('textbox', { name: 'Amount' })).not.toHaveAttribute('aria-invalid');
  });

  it('keeps a real outline on keyboard focus, and focus wins over hover and the error', () => {
    const css = join(import.meta.dirname, 'Input.module.css');
    expect(cssRule(css, '.input:focus-visible')).toMatchObject({
      outline: '2px solid var(--accent-text)',
      'outline-offset': '2px',
      'border-color': 'var(--accent-text)',
    });
    const hover = '.input:hover:where(:not(:disabled))';
    expect(cssOrder(css, hover)).toBeGreaterThan(-1);
    expect(cssOrder(css, hover)).toBeLessThan(cssOrder(css, ".input[aria-invalid='true']"));
    expect(cssOrder(css, ".input[aria-invalid='true']")).toBeLessThan(
      cssOrder(css, '.input:focus-visible'),
    );
  });

  it('darkens its edge on hover only while it can be used', () => {
    const css = join(import.meta.dirname, 'Input.module.css');
    expect(cssRule(css, '.input:hover')).toEqual({});
    expect(cssRule(css, '.input:hover:where(:not(:disabled))')).toEqual({
      'border-color': 'var(--muted-foreground)',
    });
  });

  it('is tall enough to tap and large enough that phones do not zoom on focus', () => {
    const rule = cssRule(join(import.meta.dirname, 'Input.module.css'), '.input');
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
    expect(rule['font-size']).toBe('var(--text-md)');
  });
});
