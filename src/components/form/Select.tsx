import type { ComponentProps } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { controlAttributes, useFieldControl } from './Field';
import { ariaInvalid } from './Input';
import styles from './Select.module.css';

// A list picker over Radix Select, in the parts the ported screens use:
//
//   <Field label="Relationship">
//     <Select value={value} onValueChange={setValue}>
//       <SelectTrigger><SelectValue placeholder="Choose one" /></SelectTrigger>
//       <SelectContent>
//         <SelectItem value="child">Child</SelectItem>
//       </SelectContent>
//     </Select>
//   </Field>
//
// The trigger is a combobox the Field names and describes (or give it `aria-label`). Enter,
// Space and the arrow keys open it; the arrows move, Enter chooses, Escape closes.

/** The root: `value` with `onValueChange(value)`, or `defaultValue`; also `name`, `disabled`. */
export const Select = RadixSelect.Root;

/** Shows the chosen option's text, or `placeholder` before there is one. */
export const SelectValue = RadixSelect.Value;

/** The button that opens the list. Put a SelectValue inside. */
export function SelectTrigger({
  className,
  children,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...rest
}: ComponentProps<typeof RadixSelect.Trigger>) {
  const field = useFieldControl();
  return (
    <RadixSelect.Trigger
      {...rest}
      {...controlAttributes(field, { id, describedBy, invalid: ariaInvalid(invalid) })}
      className={[styles.trigger, className].filter(Boolean).join(' ')}
    >
      <span className={styles.value}>{children}</span>
      <RadixSelect.Icon className={styles.icon}>
        <ChevronDown aria-hidden="true" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

/**
 * The list, in a portal above the screen. `position` is Radix's: "item-aligned" (the default)
 * opens it over the trigger with the chosen option in place, "popper" below it.
 */
export function SelectContent({
  className,
  children,
  position = 'item-aligned',
  ...rest
}: ComponentProps<typeof RadixSelect.Content>) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        {...rest}
        position={position}
        className={[styles.content, className].filter(Boolean).join(' ')}
      >
        <RadixSelect.ScrollUpButton className={styles.scroll}>
          <ChevronUp aria-hidden="true" />
        </RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport className={styles.viewport}>{children}</RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className={styles.scroll}>
          <ChevronDown aria-hidden="true" />
        </RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

/** One option; its text is what the trigger shows once chosen. */
export function SelectItem({
  className,
  children,
  ...rest
}: ComponentProps<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item {...rest} className={[styles.item, className].filter(Boolean).join(' ')}>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className={styles.indicator}>
        <Check aria-hidden="true" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}
