import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { VisuallyHidden } from 'radix-ui';
import { useFieldControl } from './Field';
import styles from './PinInput.module.css';

export interface PinInputProps {
  length: 4 | 6 | 8;
  /** The digits entered so far, to control it; leave it out to let the boxes keep their own. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  /** Every change, with the digits entered so far (no gaps: "12" is the first two boxes). */
  onChange?: ((value: string) => void) | undefined;
  /** Each time the last box fills, with the whole code. */
  onComplete?: ((code: string) => void) | undefined;
  /** Shows dots instead of digits (a passcode or PIN). */
  mask?: boolean | undefined;
  disabled?: boolean | undefined;
  /** The first box's id; a Field supplies it. */
  id?: string | undefined;
  /** The first box's name outside a Field. */
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  /** Reaches the first box, to focus it. */
  ref?: Ref<HTMLInputElement | null> | undefined;
  className?: string | undefined;
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * A code in separate boxes, one labelled numeric input per digit: the first is named by its Field
 * (or `aria-label`) and the rest "Digit 2 of 6" and so on. Typing moves to the next box,
 * Backspace on an empty box steps back, the arrow keys, Home and End move, and a code pasted,
 * autofilled from a text message or filled in at once lands across the boxes. There are no gaps:
 * focus on a box past the first empty one moves to that one. The boxes are one tab stop (the
 * next box to fill), so Tab moves on to the next control. Nothing is submitted on its own;
 * `onComplete` only reports the full code.
 */
export function PinInput({
  length,
  value,
  defaultValue,
  onChange,
  onComplete,
  mask = false,
  disabled = false,
  id,
  'aria-label': label,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ref,
  className,
}: PinInputProps) {
  const field = useFieldControl();
  const lengthHintId = useId();
  const [own, setOwn] = useState(() => digitsOf(defaultValue ?? '').slice(0, length));
  const current = digitsOf(value ?? own).slice(0, length);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // The newest digits, read by handlers that run before the next render. Synced after every
  // render, so a parent that keeps its value after onChange is followed too.
  const latest = useRef(current);

  useEffect(() => {
    latest.current = current;
  });

  useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
    ref,
    () => boxes.current[0] ?? null,
    [],
  );

  function focusBox(index: number) {
    boxes.current[Math.max(0, Math.min(index, length - 1))]?.focus();
  }

  function commit(next: string, focusIndex: number) {
    const previous = latest.current;
    latest.current = next;
    if (value === undefined) setOwn(next);
    if (next !== previous) {
      onChange?.(next);
      if (next.length === length) onComplete?.(next);
    }
    focusBox(focusIndex);
  }

  /** Writes `typed` from box `index` on, never past the first empty box. */
  function write(index: number, typed: string) {
    const code = latest.current;
    const start = typed.length >= length ? 0 : Math.min(index, code.length);
    const next = (code.slice(0, start) + typed + code.slice(start + typed.length)).slice(0, length);
    commit(next, start + typed.length);
  }

  function remove(index: number, focusIndex: number) {
    const code = latest.current;
    commit(code.slice(0, index) + code.slice(index + 1), focusIndex);
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const raw = event.currentTarget.value;
    if (raw === '') {
      remove(index, index);
      return;
    }
    // A keystroke reports just its own character; autofill and fillers report the whole value.
    const data = (event.nativeEvent as Partial<InputEvent>).data;
    const typed = digitsOf(typeof data === 'string' && data !== '' ? data : raw);
    if (typed !== '') write(index, typed);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    const code = latest.current;
    const last = Math.min(code.length, length - 1);
    switch (event.key) {
      case 'Backspace':
        event.preventDefault();
        if (index < code.length) remove(index, index);
        else if (index > 0) remove(index - 1, index - 1);
        break;
      case 'Delete':
        event.preventDefault();
        if (index < code.length) remove(index, index);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusBox(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusBox(Math.min(index + 1, last));
        break;
      case 'Home':
        event.preventDefault();
        focusBox(0);
        break;
      case 'End':
        event.preventDefault();
        focusBox(last);
        break;
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const typed = digitsOf(event.clipboardData.getData('text'));
    if (typed !== '') write(index, typed);
  }

  function handleFocus(index: number, event: FocusEvent<HTMLInputElement>) {
    const firstEmpty = Math.min(latest.current.length, length - 1);
    if (index > firstEmpty) focusBox(firstEmpty);
    else event.currentTarget.select();
  }

  // One tab stop, at the next box to fill (the last once full), so Tab moves on past the code.
  const stop = Math.min(current.length, length - 1);
  const shared = [field?.describedBy, describedBy].filter(Boolean).join(' ');
  const isInvalid = invalid === true || field?.invalid === true ? true : undefined;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} data-length={length}>
      <VisuallyHidden.Root id={lengthHintId}>{`${length} digits`}</VisuallyHidden.Root>
      {Array.from({ length }, (_, index) => {
        const description = index === 0 ? [lengthHintId, shared].filter(Boolean).join(' ') : shared;
        return (
          <input
            // A box is its place in the code.
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            className={styles.box}
            type={mask ? 'password' : 'text'}
            // No maxLength: a text-message code is autofilled into one box, then spread.
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 && !mask ? 'one-time-code' : 'off'}
            spellCheck={false}
            tabIndex={index === stop ? 0 : -1}
            value={current[index] ?? ''}
            disabled={disabled}
            id={index === 0 ? (field?.id ?? id) : undefined}
            aria-label={
              index === 0 ? (field ? undefined : label) : `Digit ${index + 1} of ${length}`
            }
            aria-describedby={description === '' ? undefined : description}
            aria-invalid={isInvalid}
            data-filled={index < current.length || undefined}
            onChange={(event) => handleChange(index, event)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            onFocus={(event) => handleFocus(index, event)}
          />
        );
      })}
    </div>
  );
}
