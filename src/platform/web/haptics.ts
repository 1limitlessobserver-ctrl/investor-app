// Short vibrations where the browser can vibrate (Android); silent everywhere else.

import type { HapticsAdapter } from '../types';

export const webHaptics: HapticsAdapter = {
  tick() {
    navigator.vibrate?.(10);
  },
  success() {
    navigator.vibrate?.([10, 40, 10]);
  },
  warn() {
    navigator.vibrate?.([30, 30, 30]);
  },
};
