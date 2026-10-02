import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cssRule, rem } from '../../test/cssRules';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

function Portfolio(props: { value?: string; onValueChange?: (value: string) => void }) {
  return (
    <Tabs defaultValue="holdings" {...props}>
      <TabsList aria-label="Portfolio sections">
        <TabsTrigger value="holdings">Holdings</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="statements">Statements</TabsTrigger>
      </TabsList>
      <TabsContent value="holdings">Your positions</TabsContent>
      <TabsContent value="activity">Everything that moved</TabsContent>
      <TabsContent value="statements">Monthly and quarterly</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('moves between tabs with the arrow keys, Home and End, and shows the matching panel', async () => {
    const user = userEvent.setup();
    render(<Portfolio />);
    expect(screen.getByRole('tablist', { name: 'Portfolio sections' })).toBeInTheDocument();
    screen.getByRole('tab', { name: 'Holdings', selected: true }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toHaveTextContent(
      'Everything that moved',
    );

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Statements', selected: true })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Holdings', selected: true })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel', { name: 'Holdings' })).toHaveTextContent('Your positions');
  });

  it('asks before changing when controlled', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Portfolio value="holdings" onValueChange={onValueChange} />);
    await user.click(screen.getByRole('tab', { name: 'Statements' }));
    expect(onValueChange).toHaveBeenCalledWith('statements');
    expect(screen.getByRole('tab', { name: 'Holdings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps 44 px tab targets', () => {
    const rule = cssRule(join(import.meta.dirname, 'Tabs.module.css'), '.trigger');
    expect(rem(rule['min-height'])).toBeGreaterThanOrEqual(2.75);
    expect(rem(rule['min-width'])).toBeGreaterThanOrEqual(2.75);
  });
});
