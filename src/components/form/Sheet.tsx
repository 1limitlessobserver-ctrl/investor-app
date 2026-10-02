import type { ComponentProps } from 'react';
import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useLayout } from '../../design/useLayout';
import { useReducedMotion } from '../../design/useMotion';
import styles from './Sheet.module.css';

// A sheet: rises from the bottom on phones and slides in from the right as a side panel at
// 900 px and above (useLayout). It is a modal dialog like Dialog — focus stays inside, the page
// behind does not scroll, Escape or a press outside asks to close — in the same parts:
//
//   <Sheet open={open} onOpenChange={setOpen}>
//     <SheetContent>
//       <SheetHeader>
//         <SheetTitle>…</SheetTitle>
//         <SheetDescription>…</SheetDescription>
//       </SheetHeader>
//       …
//     </SheetContent>
//   </Sheet>

export {
  DialogDescription as SheetDescription,
  DialogFooter as SheetFooter,
  DialogHeader as SheetHeader,
  DialogTitle as SheetTitle,
} from './Dialog';

/** The root: `open` with `onOpenChange(open)`, or `defaultOpen` and a SheetTrigger. */
export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

export type SheetContentProps = ComponentProps<typeof RadixDialog.Content> & {
  /** A "Close" button in the corner, on by default; leave it out when there is a Cancel. */
  closeButton?: boolean | undefined;
};

/** The sheet itself, with the dimmed overlay behind it, in a portal. `data-layout` says which. */
export function SheetContent({
  className,
  children,
  closeButton = true,
  ...rest
}: SheetContentProps) {
  const layout = useLayout();
  // The reduced-motion setting alone, so the entrance does not replay when the app comes back.
  const motion = useReducedMotion() ? 'off' : 'on';
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.overlay} data-motion={motion} />
      <RadixDialog.Content
        {...rest}
        data-layout={layout}
        data-motion={motion}
        className={[styles.content, styles[layout], className].filter(Boolean).join(' ')}
      >
        {children}
        {closeButton && (
          <RadixDialog.Close className={styles.close} aria-label="Close">
            <X aria-hidden="true" />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
