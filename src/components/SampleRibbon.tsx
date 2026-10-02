import { VisuallyHidden } from 'radix-ui';
import styles from './SampleRibbon.module.css';

/**
 * The "Sample" tab on the right edge of the screen, shown in sample mode on every screen. Render
 * it once, at the app's root, early in the page so screen readers meet it first; it reads
 * "Sample data, not a real account" and never takes a tap.
 */
export function SampleRibbon({ className }: { className?: string | undefined }) {
  return (
    <p className={[styles.ribbon, className].filter(Boolean).join(' ')}>
      <span>Sample</span>
      <VisuallyHidden.Root> data, not a real account</VisuallyHidden.Root>
    </p>
  );
}
