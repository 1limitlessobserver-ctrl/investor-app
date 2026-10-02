import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Orb } from './Orb';

describe('Orb', () => {
  it('is decoration around the icon it holds', () => {
    const { container } = render(
      <Orb size="lg">
        <svg data-icon />
      </Orb>,
    );
    const orb = container.firstElementChild;
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(orb).toHaveClass('orb', 'lg', 'solid');
    expect(orb?.querySelector('[data-icon]')).toBeInTheDocument();
  });

  it('comes as a clear glass sphere too', () => {
    const { container } = render(<Orb size="sm" tone="glass" />);
    expect(container.firstElementChild).toHaveClass('orb', 'sm', 'glass');
  });
});
