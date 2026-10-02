import { useState, type ComponentProps } from 'react';
import { Slider as RadixSlider } from 'radix-ui';
import { useFieldControl } from './Field';
import styles from './Slider.module.css';

export type SliderProps = Omit<
  ComponentProps<typeof RadixSlider.Root>,
  'aria-label' | 'aria-labelledby' | 'aria-describedby'
> & {
  /** The thumb's name; a Field names it otherwise. */
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  /** How a value reads aloud, e.g. (v) => `$${v} a month`; the bare number when left out. */
  valueText?: ((value: number) => string) | undefined;
};

/**
 * A range slider over Radix: `value: number[]` (one entry per thumb) with
 * `onValueChange(values)` while it moves and `onValueCommit(values)` when it settles, or
 * `defaultValue` to keep its own; `min`, `max` and `step` as usual. The thumb carries the
 * `role="slider"`, its name (Field or `aria-label`) and `valueText`. Arrow keys step, Page Up and
 * Down step by ten, Home and End jump to the ends.
 */
export function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  valueText,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  ...rest
}: SliderProps) {
  const field = useFieldControl();
  const [own, setOwn] = useState(() => defaultValue ?? [rest.min ?? 0]);
  const values = value ?? own;
  const description = [field?.describedBy, describedBy].filter(Boolean).join(' ');

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
          aria-label={label}
          aria-labelledby={label === undefined ? (labelledBy ?? field?.labelId) : undefined}
          aria-describedby={description === '' ? undefined : description}
          aria-valuetext={valueText?.(thumbValue)}
        />
      ))}
    </RadixSlider.Root>
  );
}
