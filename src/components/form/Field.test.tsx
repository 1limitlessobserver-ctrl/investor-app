import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';
import { Input } from './Input';
import { Textarea } from './Textarea';

describe('Field', () => {
  it('names its control with the label', () => {
    render(
      <Field label="Email">
        <Input type="email" />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBe(screen.getByRole('textbox'));
  });

  it('describes the control with the hint and leaves it valid without an error', () => {
    render(
      <Field label="Reference" hint="It is on your bank transfer.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Reference' });
    expect(input).toHaveAccessibleDescription('It is on your bank transfer.');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks the control invalid and announces the error, keeping the hint', () => {
    render(
      <Field label="Amount" hint="Up to your cash balance." error="Enter an amount above zero.">
        <Input inputMode="decimal" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Up to your cash balance. Enter an amount above zero.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount above zero.');
  });

  it('keeps a description the control brings and uses the id the field is given', () => {
    render(
      <>
        <p id="own">Shown on your statement.</p>
        <Field label="Note" id="note" error="Keep it under 140 characters.">
          <Textarea aria-describedby="own" />
        </Field>
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Note' });
    expect(textarea).toHaveAttribute('id', 'note');
    expect(textarea).toHaveAccessibleDescription(
      'Keep it under 140 characters. Shown on your statement.',
    );
  });

  it('announces the same error again when a new attempt brings it back', () => {
    const field = (attempt: number) => (
      <Field label="Email" error="Wrong email or password." errorKey={attempt}>
        <Input type="email" />
      </Field>
    );
    const { rerender } = render(field(1));
    const first = screen.getByRole('alert');
    rerender(field(1));
    expect(screen.getByRole('alert')).toBe(first);
    rerender(field(2));
    expect(screen.getByRole('alert')).not.toBe(first);
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('treats an empty error as none', () => {
    render(
      <Field label="City" error="">
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'City' })).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
