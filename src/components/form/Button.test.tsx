import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type FormEvent, type MouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule, cssValues, rem } from '../../test/cssRules';
import { Button } from './Button';

const CSS = join(import.meta.dirname, 'Button.module.css');

describe('Button', () => {
  it('is a plain button unless asked to submit, so a form never submits by accident', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Preview</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('runs onClick when pressed by pointer or keyboard, and never while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Send</Button>);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(
      <Button onClick={onClick} disabled>
        Send
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('keeps its name and focus while loading, says it is busy and ignores presses', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>
          Unlock
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Unlock' });
    button.focus();
    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick} loading>
          Unlock
        </Button>
      </form>,
    );
    expect(button).toHaveAccessibleName('Unlock');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('passes a ref and native attributes to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} aria-label="Close" className="extra" variant="ghost" size="sm">
        ×
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(ref.current).toHaveClass('extra');
  });

  it('lends its look to a link when asked, instead of rendering a button', () => {
    render(
      <Button asChild variant="outline" size="lg">
        <a href="https://example.com/update">Get the update</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Get the update' });
    expect(link).toHaveAttribute('href', 'https://example.com/update');
    expect(link).toHaveClass('button', 'outline', 'lg');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes its attributes, ref and press on to the child it lends its look to', async () => {
    const onClick = vi.fn<(event: MouseEvent) => void>((event) => event.preventDefault());
    let received: Element | null = null;
    render(
      <Button
        asChild
        onClick={onClick}
        ref={(element) => {
          received = element;
        }}
        title="Opens the store"
        aria-describedby="where"
      >
        <a href="https://example.com/update" className="own">
          Get the update
        </a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Get the update' });
    expect(received).toBe(link);
    expect(link).toHaveAttribute('title', 'Opens the store');
    expect(link).toHaveAttribute('aria-describedby', 'where');
    expect(link).toHaveClass('button', 'own');
    expect(link).not.toHaveAttribute('type');
    await userEvent.setup().click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a 44 px target at every size', () => {
    expect(rem(cssRule(CSS, '.button')['min-height'])).toBeGreaterThanOrEqual(2.75);
    expect(rem(cssRule(CSS, '.button')['min-width'])).toBeGreaterThanOrEqual(2.75);
    for (const value of cssValues(CSS, 'min-height'))
      expect(rem(value)).toBeGreaterThanOrEqual(2.75);
    for (const size of ['.sm', '.md', '.lg']) {
      expect(rem(cssRule(CSS, size)['min-height'])).toBeGreaterThanOrEqual(2.75);
    }
  });
});
