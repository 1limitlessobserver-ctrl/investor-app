import { format } from '../lib/format';
import { useAppSession } from '../session/AppSession';
import styles from './Amount.module.css';

export interface AmountProps {
  /** The figure in integer cents; null while it is not known yet. */
  cents: number | null;
  /** Its currency code; USD unless given. */
  currency?: string | undefined;
  className?: string | undefined;
}

/**
 * A money figure. Offline it is hidden, whatever is known: "•••", named "Hidden while offline".
 * Until it is known, a dash holds its place (hidden from assistive technology). Every one carries
 * `data-amount`, which the end-to-end tests and audits look for. (Task 10 adds the count-up.)
 */
export function Amount({ cents, currency = 'USD', className }: AmountProps) {
  const { online } = useAppSession();
  const classes = [styles.amount, className].filter(Boolean).join(' ');
  if (!online) {
    return (
      <span data-amount="" role="img" aria-label="Hidden while offline" className={classes}>
        •••
      </span>
    );
  }
  if (cents === null) {
    return (
      <span data-amount="" aria-hidden="true" className={classes}>
        —
      </span>
    );
  }
  return (
    <span data-amount="" className={classes}>
      {format.money(cents, currency)}
    </span>
  );
}
