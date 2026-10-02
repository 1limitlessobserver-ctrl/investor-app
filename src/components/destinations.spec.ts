import { describe, expect, it } from 'vitest';
import { alertsLabel, badgeText, MAIN_DESTINATIONS } from './destinations';

describe('destinations', () => {
  it('lists the five main destinations in tab order', () => {
    expect(MAIN_DESTINATIONS.map(({ label, to }) => `${label} ${to}`)).toEqual([
      'Home /',
      'Portfolio /portfolio',
      'Move /move',
      'Legacy /legacy',
      'Profile /profile',
    ]);
  });

  it('names the bell with the unread count, zero included', () => {
    expect(alertsLabel(3)).toBe('Alerts, 3 unread');
    expect(alertsLabel(0)).toBe('Alerts, 0 unread');
  });

  it('shows a badge from one unread alert, capped at 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
