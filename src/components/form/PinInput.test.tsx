import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssOrder, cssRule, rem } from '../../test/cssRules';
import { Field } from './Field';
import { PinInput } from './PinInput';

function boxes(): HTMLInputElement[] {
  return screen.getAllByRole<HTMLInputElement>('textbox');
}

function values(): string {
  return boxes()
    .map((box) => box.value || '_')
    .join('');
}

describe('PinInput', () => {
  it('has one labelled numeric input per digit; the Field names the first', () => {
    render(
      <Field label="Six-digit code" hint="From your authenticator app.">
        <PinInput length={6} />
      </Field>,
    );
    expect(boxes()).toHaveLength(6);
    const first = screen.getByLabelText('Six-digit code');
    expect(first).toBe(boxes()[0]);
    expect(first).toHaveAccessibleDescription('6 digits From your authenticator app.');
    expect(first).toHaveAttribute('autocomplete', 'one-time-code');
    for (const [index, box] of boxes().entries()) {
      expect(box).toHaveAttribute('inputmode', 'numeric');
      if (index > 0) expect(box).toHaveAccessibleName(`Digit ${index + 1} of 6`);
    }
  });

  it('moves to the next box as digits are typed and completes once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(
      <PinInput length={4} aria-label="Transfer PIN" onChange={onChange} onComplete={onComplete} />,
    );
    await user.type(screen.getByLabelText('Transfer PIN'), '2468');
    expect(values()).toBe('2468');
    expect(onChange.mock.calls).toEqual([['2'], ['24'], ['246'], ['2468']]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('2468');
    expect(boxes()[3]).toHaveFocus();
  });

  it('ignores anything but digits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PinInput length={4} aria-label="Transfer PIN" onChange={onChange} />);
    await user.type(screen.getByLabelText('Transfer PIN'), 'a1-b2');
    expect(values()).toBe('12__');
    expect(onChange.mock.calls).toEqual([['1'], ['12']]);
  });

  it('spreads a pasted code over the boxes, whatever box has focus', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<PinInput length={6} aria-label="Code" onComplete={onComplete} />);
    await user.click(screen.getByLabelText('Code'));
    await user.paste('123 456');
    expect(values()).toBe('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxes()[5]).toHaveFocus();
  });

  it('takes a whole code put into one box at once, as autofill and form fillers do', () => {
    const onComplete = vi.fn();
    render(<PinInput length={6} aria-label="Passcode" onComplete={onComplete} />);
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: '246810' } });
    expect(values()).toBe('246810');
    expect(onComplete).toHaveBeenCalledWith('246810');
  });

  it('steps back with Backspace from an empty box and clears the digit there', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PinInput length={4} aria-label="Transfer PIN" onChange={onChange} />);
    await user.type(screen.getByLabelText('Transfer PIN'), '135');
    expect(boxes()[3]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(values()).toBe('13__');
    expect(boxes()[2]).toHaveFocus();
    await user.keyboard('{Backspace}{Backspace}');
    expect(values()).toBe('____');
    expect(boxes()[0]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('moves with the arrow keys, Home and End, and replaces a digit typed over', async () => {
    const user = userEvent.setup();
    render(<PinInput length={4} aria-label="Transfer PIN" defaultValue="1234" />);
    const [first, second, , fourth] = boxes();
    first?.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    await user.keyboard('9');
    expect(values()).toBe('1934');
    await user.keyboard('{End}');
    expect(fourth).toHaveFocus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(first).toHaveFocus();
  });

  it('takes only the key typed when the caret sits beside a digit, not over it', async () => {
    const user = userEvent.setup();
    render(<PinInput length={4} aria-label="Transfer PIN" defaultValue="1234" />);
    const second = boxes()[1];
    if (!second) throw new Error('No second box.');
    await user.click(second);
    // A second press inside a focused box drops the selection and leaves the caret after "2".
    second.setSelectionRange(1, 1);
    await user.keyboard('9');
    expect(values()).toBe('1934');
  });

  it('sends focus to the first empty box rather than leaving a gap', async () => {
    const user = userEvent.setup();
    render(<PinInput length={6} aria-label="Code" />);
    await user.click(boxes()[4]!);
    expect(boxes()[0]).toHaveFocus();
    await user.keyboard('7');
    expect(values()).toBe('7_____');
  });

  it('is one tab stop, at the next box to fill, so Tab moves on past it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <PinInput length={6} aria-label="Code" defaultValue="12" />
        <button type="button">After</button>
      </>,
    );
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(boxes()[2]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(boxes()[2]).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  });

  it('follows a parent that keeps fewer digits, completing only what it shows', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    function Capped() {
      const [pin, setPin] = useState('');
      return (
        <PinInput
          length={4}
          aria-label="PIN"
          value={pin}
          onChange={(next) => setPin(next.slice(0, 2))}
          onComplete={onComplete}
        />
      );
    }
    render(<Capped />);
    await user.type(screen.getByLabelText('PIN'), '1234');
    expect(values()).toBe('12__');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('completes once a parent takes the last digit', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    function Controlled() {
      const [pin, setPin] = useState('');
      return (
        <PinInput
          length={4}
          aria-label="PIN"
          value={pin}
          onChange={setPin}
          onComplete={onComplete}
        />
      );
    }
    render(<Controlled />);
    await user.type(screen.getByLabelText('PIN'), '2468');
    expect(values()).toBe('2468');
    expect(onComplete.mock.calls).toEqual([['2468']]);
  });

  it('follows a value it is given, and masks the digits when asked', () => {
    function Controlled() {
      const [pin, setPin] = useState('12');
      return <PinInput length={4} mask aria-label="PIN" value={pin} onChange={setPin} />;
    }
    render(<Controlled />);
    const first = screen.getByLabelText<HTMLInputElement>('PIN');
    expect(first).toHaveAttribute('type', 'password');
    expect(first.value).toBe('1');
    expect(first).toHaveAttribute('autocomplete', 'off');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('hands its ref the first box and marks every box invalid in an invalid Field', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Field label="Passcode" error="That passcode didn't match. 4 attempts left.">
        <PinInput length={6} ref={ref} />
      </Field>,
    );
    expect(ref.current).toBe(boxes()[0]);
    for (const box of boxes()) expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(boxes()[2]).toHaveAccessibleDescription("That passcode didn't match. 4 attempts left.");
  });

  it('keeps a real outline on keyboard focus, winning over a filled box and the error', () => {
    const css = join(import.meta.dirname, 'PinInput.module.css');
    expect(cssRule(css, '.box:focus-visible')).toMatchObject({
      outline: '2px solid var(--accent-text)',
      'outline-offset': '2px',
      'border-color': 'var(--accent-text)',
    });
    expect(cssOrder(css, '.box[data-filled]')).toBeGreaterThan(-1);
    expect(cssOrder(css, '.box[data-filled]')).toBeLessThan(
      cssOrder(css, ".box[aria-invalid='true']"),
    );
    expect(cssOrder(css, ".box[aria-invalid='true']")).toBeLessThan(
      cssOrder(css, '.box:focus-visible'),
    );
  });

  it('keeps 44 px boxes', () => {
    const rule = cssRule(join(import.meta.dirname, 'PinInput.module.css'), '.box');
    expect(rem(rule['width'])).toBeGreaterThanOrEqual(2.75);
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
  });
});
