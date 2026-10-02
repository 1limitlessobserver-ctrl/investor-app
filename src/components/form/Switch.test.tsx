import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cssRule, rem } from '../../test/cssRules';
import { Field } from './Field';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is named and described by its Field and reports a press as the next state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Field label="Deposits" hint="When money arrives in your wallet." inline>
        <Switch checked={false} onCheckedChange={onCheckedChange} />
      </Field>,
    );
    const toggle = screen.getByRole('switch', { name: 'Deposits' });
    expect(toggle).toHaveAccessibleDescription('When money arrives in your wallet.');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(toggle).not.toBeChecked(); // controlled: the screen decides
  });

  it('toggles from the keyboard when left to keep its own state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="App lock" defaultChecked onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'App lock' });
    expect(toggle).toBeChecked();
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).not.toBeChecked();
    await user.keyboard('{Enter}');
    expect(toggle).toBeChecked();
    expect(onCheckedChange.mock.calls).toEqual([[false], [true]]);
  });

  it('cannot be changed while disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Security alerts" disabled onCheckedChange={onCheckedChange} />);
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Security alerts' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('keeps a 44 px target', () => {
    const rule = cssRule(join(import.meta.dirname, 'Switch.module.css'), '.root');
    expect(rem(rule['min-width'])).toBeGreaterThanOrEqual(2.75);
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
  });
});
