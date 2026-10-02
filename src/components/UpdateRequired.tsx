import { useState } from 'react';
import { VisuallyHidden } from 'radix-ui';
import { BrandMark, type BrandIdentity } from './BrandMark';
import { Button } from './form/Button';
import styles from './UpdateRequired.module.css';

export interface UpdateRequiredProps {
  /** The company's mark and name; null when the brand is not known yet. */
  brand: BrandIdentity | null;
  /** The lowest version the platform accepts ("1.4.0"), or '' when it did not say. */
  minVersion: string;
  /** A store page for the update, opened in a new tab; without one, Reload gets the new version. */
  storeUrl?: string | null | undefined;
  /**
   * What Reload does; reloading the page when left out. While the promise it may answer is
   * pending (taking a new version can wait on the service worker), Reload shows it is busy.
   */
  onReload?: (() => void | Promise<void>) | undefined;
  /** Sign out still works here. */
  onSignOut: () => void;
}

/**
 * Shown instead of the whole app when the platform needs a newer version (426): the brand, "Update
 * the app" as the page's `<h1>`, the way to update and "Sign out". It is the page's `<main>`, so
 * render it in place of the app, not inside a shell.
 */
export function UpdateRequired({
  brand,
  minVersion,
  storeUrl,
  onReload,
  onSignOut,
}: UpdateRequiredProps) {
  const target = minVersion ? `version ${minVersion} or later` : 'the latest version';
  const [reloading, setReloading] = useState(false);

  async function reload() {
    setReloading(true);
    try {
      await (onReload ?? (() => window.location.reload()))();
    } finally {
      setReloading(false);
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.content}>
        {brand && (
          <BrandMark
            name={brand.name}
            logoDataUrl={brand.logoDataUrl}
            size="lg"
            className={styles.brand}
          />
        )}
        <h1 className={styles.title}>Update the app</h1>
        <p className={styles.detail}>
          This version is no longer supported. Update to {target} to carry on.
        </p>
        <div className={styles.actions}>
          {storeUrl ? (
            <Button asChild size="lg">
              <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                Get the update <VisuallyHidden.Root>(opens in a new tab)</VisuallyHidden.Root>
              </a>
            </Button>
          ) : (
            <Button size="lg" loading={reloading} onClick={() => void reload()}>
              Reload
            </Button>
          )}
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
