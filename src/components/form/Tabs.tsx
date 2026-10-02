import type { ComponentProps } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import styles from './Tabs.module.css';

// Tabs over Radix, in the parts the ported screens use:
//
//   <Tabs value={tab} onValueChange={setTab}>
//     <TabsList aria-label="Portfolio sections">
//       <TabsTrigger value="holdings">Holdings</TabsTrigger> …
//     </TabsList>
//     <TabsContent value="holdings">…</TabsContent> …
//   </Tabs>
//
// The arrow keys move between tabs and select them (Home and End jump to the ends, and the ends
// wrap); Tab moves on into the panel.

function classes(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** The root: `value` with `onValueChange(value)`, or `defaultValue`. */
export function Tabs({ className, ...rest }: ComponentProps<typeof RadixTabs.Root>) {
  return <RadixTabs.Root {...rest} className={classes(styles.root, className)} />;
}

/** The row of tabs; name it with `aria-label`. It scrolls sideways when the tabs do not fit. */
export function TabsList({ className, ...rest }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List {...rest} className={classes(styles.list, className)} />;
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RadixTabs.Trigger>) {
  return <RadixTabs.Trigger {...rest} className={classes(styles.trigger, className)} />;
}

/** A panel, named by its tab; only the selected one is mounted. */
export function TabsContent({ className, ...rest }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content {...rest} className={classes(styles.content, className)} />;
}
