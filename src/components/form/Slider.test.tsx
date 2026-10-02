import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubRadixBrowserApis } from '../../test/browserStubs';
import { Field } from './Field';
import { Slider } from './Slider';

beforeAll(stubRadixBrowserApis);
afterAll(() => vi.unstubAllGlobals());

describe('Slider', () => {
  it('names its thumb, reads its value aloud and steps with the keyboard', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <Slider
        aria-label="Monthly contribution"
        min={0}
        max={5000}
        step={50}
        value={[500]}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        valueText={(value) => `$${value} a month`}
      />,
    );
    const thumb = screen.getByRole('slider', { name: 'Monthly contribution' });
    expect(thumb).toHaveAttribute('aria-valuenow', '500');
    expect(thumb).toHaveAttribute('aria-valuemin', '0');
    expect(thumb).toHaveAttribute('aria-valuemax', '5000');
    expect(thumb).toHaveAttribute('aria-valuetext', '$500 a month');
    thumb.focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith([550]);
    expect(onValueCommit).toHaveBeenLastCalledWith([550]);
    await user.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith([5000]);
  });

  it('takes its name and description from a Field', () => {
    render(
      <Field label="Horizon" hint="In years.">
        <Slider min={1} max={40} defaultValue={[20]} />
      </Field>,
    );
    const thumb = screen.getByRole('slider', { name: 'Horizon' });
    expect(thumb).toHaveAccessibleDescription('In years.');
    expect(thumb).toHaveAttribute('aria-valuenow', '20');
  });

  it('gives the Field its first thumb to point at, and marks it invalid', () => {
    render(
      <Field label="Horizon" error="Keep it under 40 years.">
        <Slider min={1} max={60} defaultValue={[50]} />
      </Field>,
    );
    const thumb = screen.getByRole('slider', { name: 'Horizon' });
    expect(thumb.id).not.toBe('');
    expect(document.querySelector('label')).toHaveAttribute('for', thumb.id);
    expect(thumb).toHaveAttribute('aria-invalid', 'true');
    expect(thumb).toHaveAccessibleDescription('Keep it under 40 years.');
  });

  it('can be marked invalid outside a Field', () => {
    render(<Slider aria-label="Draw rate" aria-invalid defaultValue={[12]} max={10} />);
    expect(screen.getByRole('slider', { name: 'Draw rate' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('moves on its own state when uncontrolled', async () => {
    const user = userEvent.setup();
    render(<Slider aria-label="Draw rate" min={0} max={10} step={0.5} defaultValue={[4]} />);
    const thumb = screen.getByRole('slider', { name: 'Draw rate' });
    thumb.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(thumb).toHaveAttribute('aria-valuenow', '3');
  });
});
