import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SampleRibbon } from './SampleRibbon';

describe('SampleRibbon', () => {
  it('shows the word Sample on its own and says what it means', () => {
    const { container } = render(<SampleRibbon />);
    expect(screen.getByText('Sample', { exact: true })).toBeVisible();
    expect(container.firstElementChild).toHaveTextContent('Sample data, not a real account');
  });
});
