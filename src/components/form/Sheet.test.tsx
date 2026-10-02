import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../../test/stubMatchMedia';
import { Button } from './Button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './Sheet';

function Reinvest({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Reinvest matured capital</SheetTitle>
          <SheetDescription>Choose where it goes next.</SheetDescription>
        </SheetHeader>
        <Button>Reinvest</Button>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rises from the bottom on phones', () => {
    stubMatchMedia(false);
    render(<Reinvest onOpenChange={() => {}} />);
    const sheet = screen.getByRole('dialog', { name: 'Reinvest matured capital' });
    expect(sheet).toHaveAttribute('data-layout', 'phone');
    expect(sheet).toHaveAccessibleDescription('Choose where it goes next.');
  });

  it('opens as a side panel at 900 px and above', () => {
    stubMatchMedia(true);
    render(<Reinvest onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Reinvest matured capital' })).toHaveAttribute(
      'data-layout',
      'wide',
    );
  });

  it('holds focus inside, locks the page behind and asks to close on Escape', async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Reinvest onOpenChange={onOpenChange} />);
    const reinvest = screen.getByRole('button', { name: 'Reinvest' });
    expect(reinvest).toHaveFocus();
    expect(document.body).toHaveAttribute('data-scroll-locked');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(reinvest).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
