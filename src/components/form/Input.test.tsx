import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule, rem } from '../../test/cssRules';
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

  it('is tall enough to tap and large enough that phones do not zoom on focus', () => {
    const rule = cssRule(join(import.meta.dirname, 'Input.module.css'), '.input');
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
    expect(rule['font-size']).toBe('var(--text-md)');
  });
});
