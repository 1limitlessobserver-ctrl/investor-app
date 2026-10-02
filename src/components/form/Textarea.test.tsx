import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
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
});
