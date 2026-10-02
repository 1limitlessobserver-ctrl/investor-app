import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './Dialog';

function NewRequest({ closeButton }: { closeButton?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Write to support</Button>
      </DialogTrigger>
      <DialogContent {...(closeButton === undefined ? {} : { closeButton })}>
        <DialogHeader>
          <DialogTitle>New request</DialogTitle>
          <DialogDescription>Say what it is about.</DialogDescription>
        </DialogHeader>
        <input aria-label="Subject" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button>Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens as a named, described dialog with focus inside and the page behind locked', async () => {
    const user = userEvent.setup();
    render(<NewRequest />);
    await user.click(screen.getByRole('button', { name: 'Write to support' }));
    const dialog = screen.getByRole('dialog', { name: 'New request' });
    expect(dialog).toHaveAccessibleDescription('Say what it is about.');
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveFocus();
    expect(document.body).toHaveAttribute('data-scroll-locked');
  });

  it('keeps focus inside while open', async () => {
    const user = userEvent.setup();
    render(<NewRequest />);
    await user.click(screen.getByRole('button', { name: 'Write to support' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape and hands focus back to what opened it', async () => {
    const user = userEvent.setup();
    render(<NewRequest />);
    const trigger = screen.getByRole('button', { name: 'Write to support' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
  });

  it('closes from its close button, or leaves that out on request', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NewRequest />);
    await user.click(screen.getByRole('button', { name: 'Write to support' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(<NewRequest closeButton={false} />);
    await user.click(screen.getByRole('button', { name: 'Write to support' }));
    expect(screen.getByRole('dialog', { name: 'New request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
