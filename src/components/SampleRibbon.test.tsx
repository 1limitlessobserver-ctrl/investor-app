import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../test/cssRules';
import { SampleRibbon } from './SampleRibbon';

describe('SampleRibbon', () => {
  it('shows the word Sample on its own and says what it means', () => {
    const { container } = render(<SampleRibbon />);
    expect(screen.getByText('Sample', { exact: true })).toBeVisible();
    expect(container.firstElementChild).toHaveTextContent('Sample data, not a real account');
  });

  it('keeps inside the safe area, clear of a notch in landscape', () => {
    const ribbon = cssRule(join(import.meta.dirname, 'SampleRibbon.module.css'), '.ribbon');
    expect(ribbon.right).toBe('var(--safe-right)');
  });
});
