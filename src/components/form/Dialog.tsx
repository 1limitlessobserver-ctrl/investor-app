import type { ComponentProps } from 'react';
import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useMotion } from '../../design/useMotion';
import styles from './Dialog.module.css';

// A centred modal dialog over Radix, in the parts the ported screens use:
//
//   <Dialog open={open} onOpenChange={setOpen}>
//     <DialogContent>
//       <DialogHeader>
//         <DialogTitle>New request</DialogTitle>
//         <DialogDescription>Say what it is about.</DialogDescription>
//       </DialogHeader>
//       …
//       <DialogFooter>…</DialogFooter>
//     </DialogContent>
//   </Dialog>
//
// While open, focus stays inside, the page behind is hidden from assistive technology and does
// not scroll, and Escape, a press outside or the close button asks to close. Always give it a
// DialogTitle: that names it.

function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** The root: `open` with `onOpenChange(open)`, or `defaultOpen` and a DialogTrigger. */
export const Dialog = RadixDialog.Root;
/** Opens the dialog; use `asChild` to make a Button the trigger. */
export const DialogTrigger = RadixDialog.Trigger;
/** Closes the dialog; use `asChild` around a Button such as Cancel. */
export const DialogClose = RadixDialog.Close;

export type DialogContentProps = ComponentProps<typeof RadixDialog.Content> & {
  /** A "Close" button in the corner, on by default; leave it out when the footer has Cancel. */
  closeButton?: boolean;
};

/** The dialog itself, with the dimmed overlay behind it, in a portal. */
export function DialogContent({
  className,
  children,
  closeButton = true,
  ...rest
}: DialogContentProps) {
  const motion = useMotion().animate ? 'on' : 'off';
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.overlay} data-motion={motion} />
      <RadixDialog.Content
        {...rest}
        data-motion={motion}
        className={classes(styles.content, className)}
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

/** The title and description, stacked. */
export function DialogHeader({ className, ...rest }: ComponentProps<'div'>) {
  return <div {...rest} className={classes(styles.header, className)} />;
}

/** The actions: in a row at the end, the last (main) one on top when they wrap. */
export function DialogFooter({ className, ...rest }: ComponentProps<'div'>) {
  return <div {...rest} className={classes(styles.footer, className)} />;
}

/** Names the dialog (an `<h2>`). */
export function DialogTitle({ className, ...rest }: ComponentProps<typeof RadixDialog.Title>) {
  return <RadixDialog.Title {...rest} className={classes(styles.title, className)} />;
}

/** Describes the dialog; read when it opens. */
export function DialogDescription({
  className,
  ...rest
}: ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description {...rest} className={classes(styles.description, className)} />;
}
