import { useState, type ComponentProps } from 'react';
import { Slider as RadixSlider } from 'radix-ui';
import { useFieldControl } from './Field';
import styles from './Slider.module.css';

export type SliderProps = Omit<
  ComponentProps<typeof RadixSlider.Root>,
  'id' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'
> & {
  /** The first thumb's id; a Field supplies it, so its label points at the thumb. */
  id?: string | undefined;
  /** The thumb's name; a Field names it otherwise. */
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  /** Marks the thumbs invalid outside a Field; a Field's error does it inside one. */
  'aria-invalid'?: boolean | undefined;
  /** How a value reads aloud, e.g. (v) => `$${v} a month`; the bare number when left out. */
  valueText?: ((value: number) => string) | undefined;
};

/**
 * A range slider over Radix: `value: number[]` (one entry per thumb) with
 * `onValueChange(values)` while it moves and `onValueCommit(values)` when it settles, or
 * `defaultValue` to keep its own; `min`, `max` and `step` as usual. The thumb carries the
 * `role="slider"`, the id a Field's label points at (the first thumb), its name (Field or
 * `aria-label`), validity and `valueText`. Arrow keys step, Page Up and Down step by ten, Home and
 * End jump to the ends.
 */
export function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  valueText,
  id,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': ownInvalid,
  ...rest
}: SliderProps) {
  const field = useFieldControl();
  const [own, setOwn] = useState(() => defaultValue ?? [rest.min ?? 0]);
  const values = value ?? own;
  const description = [field?.describedBy, describedBy].filter(Boolean).join(' ');
  const invalid = ownInvalid === true || field?.invalid === true ? true : undefined;

  function change(next: number[]) {
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  }

  return (
    <RadixSlider.Root
      {...rest}
      value={values}
      onValueChange={change}
      className={[styles.root, className].filter(Boolean).join(' ')}
    >
      <RadixSlider.Track className={styles.track}>
        <RadixSlider.Range className={styles.range} />
      </RadixSlider.Track>
      {values.map((thumbValue, index) => (
        <RadixSlider.Thumb
          // A thumb is its place in the list; thumbs never reorder.
          key={index}
          className={styles.thumb}
          id={index === 0 ? (field?.id ?? id) : undefined}
          aria-label={label}
          aria-labelledby={label === undefined ? (labelledBy ?? field?.labelId) : undefined}
          aria-describedby={description === '' ? undefined : description}
          aria-invalid={invalid}
          aria-valuetext={valueText?.(thumbValue)}
        />
      ))}
    </RadixSlider.Root>
  );
}
