import { AppWindowMac, Share } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { reportProblem } from '../lib/report';
import { platform } from '../platform';
import type { InstallAdapter } from '../platform/types';
import { Button } from './form/Button';
import styles from './InstallButton.module.css';

export interface InstallButtonProps {
  /** Where it stands: below the sign-in form, or among Profile's rows. */
  placement: 'sign-in' | 'profile';
  /** The device's install adapter; the browser's unless a screen passes the session's own. */
  install?: InstallAdapter | undefined;
}

/** What the device lets the app offer: its prompt, Safari's own steps, or nothing. */
type Offer = 'installed' | 'prompt' | 'safari-ios' | 'safari-mac' | 'none';

function offerOf(install: InstallAdapter): Offer {
  if (install.isInstalled()) return 'installed';
  if (install.canPrompt()) return 'prompt';
  return install.hint() ?? 'none';
}

/** Safari has no install prompt: the steps to install the app from its own menus. */
const STEPS = {
  'safari-ios': { Icon: Share, text: 'To install the app, tap Share → Add to Home Screen.' },
  'safari-mac': { Icon: AppWindowMac, text: 'To install the app, choose File → Add to Dock.' },
} as const;

/**
 * Installing the app from the browser: "Install app" while the browser offers its install prompt
 * (shown from the tap itself), Safari's steps where it has none, and nothing once the app is
 * installed, the investor has accepted the prompt, or the browser offers neither. It follows the
 * adapter's changes (a prompt offered late, the app installed meanwhile).
 */
export function InstallButton({ placement, install = platform.install }: InstallButtonProps) {
  const subscribe = useCallback((listener: () => void) => install.subscribe(listener), [install]);
  const offer = useSyncExternalStore(subscribe, () => offerOf(install));
  const [accepted, setAccepted] = useState(false);

  async function showPrompt() {
    try {
      // Called at once, inside the tap: the browser shows its prompt only for a user gesture.
      if ((await install.prompt()) === 'accepted') setAccepted(true);
    } catch (error) {
      reportProblem('showing the install prompt', error);
    }
  }

  if (accepted || offer === 'installed' || offer === 'none') return null;
  if (offer === 'prompt') {
    return (
      <Button
        variant="outline"
        className={styles.button}
        data-placement={placement}
        onClick={() => void showPrompt()}
      >
        Install app
      </Button>
    );
  }
  const { Icon, text } = STEPS[offer];
  return (
    <p className={styles.steps} data-placement={placement}>
      <Icon aria-hidden="true" className={styles.icon} />
      <span>{text}</span>
    </p>
  );
}
