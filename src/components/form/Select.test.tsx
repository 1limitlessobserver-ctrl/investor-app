import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubRadixBrowserApis } from '../../test/browserStubs';
import { cssOrder, cssRule } from '../../test/cssRules';
import { Field } from './Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select';

beforeAll(stubRadixBrowserApis);
afterAll(() => vi.unstubAllGlobals());

function Relationship(props: { value?: string; onValueChange?: (value: string) => void }) {
  return (
    <Field
      label="Relationship"
      hint="How they are related to you."
      error={props.value ? '' : 'Choose one.'}
    >
      <Select {...props}>
        <SelectTrigger>
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="spouse">Spouse</SelectItem>
          <SelectItem value="child">Child</SelectItem>
          <SelectItem value="sibling">Sibling</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

describe('Select', () => {
  it('shows the chosen option on a trigger the Field names and describes', () => {
    render(<Relationship value="child" />);
    const trigger = screen.getByRole('combobox', { name: 'Relationship' });
    expect(trigger).toHaveTextContent('Child');
    expect(trigger).toHaveAccessibleDescription('How they are related to you.');
    expect(trigger).not.toHaveAttribute('aria-invalid');
  });

  it('shows the placeholder and the Field error before anything is chosen', () => {
    render(<Relationship />);
    const trigger = screen.getByRole('combobox', { name: 'Relationship' });
    expect(trigger).toHaveTextContent('Choose one');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
  });

  it('opens from the keyboard, moves through the options and reports the choice', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Relationship value="child" onValueChange={onValueChange} />);
    screen.getByRole('combobox', { name: 'Relationship' }).focus();
    await user.keyboard('{Enter}');
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeVisible();
    expect(screen.getByRole('option', { name: 'Child' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('sibling');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Relationship' })).toHaveFocus();
  });

  it('closes on Escape without choosing', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Relationship value="spouse" onValueChange={onValueChange} />);
    screen.getByRole('combobox', { name: 'Relationship' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('darkens the trigger’s edge on hover only while it can be used', () => {
    const css = join(import.meta.dirname, 'Select.module.css');
    expect(cssRule(css, '.trigger:hover')).toEqual({});
    expect(cssRule(css, '.trigger:hover:where(:not(:disabled))')).toEqual({
      'border-color': 'var(--muted-foreground)',
    });
  });

  it('keeps a real outline on keyboard focus, and focus wins over hover and the error', () => {
    const css = join(import.meta.dirname, 'Select.module.css');
    expect(cssRule(css, '.trigger:focus-visible')).toMatchObject({
      outline: '2px solid var(--accent-text)',
      'outline-offset': '2px',
      'border-color': 'var(--accent-text)',
    });
    const hover = '.trigger:hover:where(:not(:disabled))';
    expect(cssOrder(css, hover)).toBeGreaterThan(-1);
    expect(cssOrder(css, hover)).toBeLessThan(cssOrder(css, ".trigger[aria-invalid='true']"));
    expect(cssOrder(css, ".trigger[aria-invalid='true']")).toBeLessThan(
      cssOrder(css, '.trigger:focus-visible'),
    );
  });

  it('outlines the highlighted option in the readable accent', () => {
    const css = join(import.meta.dirname, 'Select.module.css');
    expect(cssRule(css, '.item[data-highlighted]')).toMatchObject({
      outline: '2px solid var(--accent-text)',
      'outline-offset': '-2px',
    });
  });
});
