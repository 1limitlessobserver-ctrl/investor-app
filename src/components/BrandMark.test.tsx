import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

const LOGO = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';

describe('BrandMark', () => {
  it('shows the logo beside the company name, the logo then being decoration', () => {
    const { container } = render(<BrandMark name="Northwind Wealth" logoDataUrl={LOGO} />);
    expect(screen.getByText('Northwind Wealth')).toBeInTheDocument();
    const logo = container.querySelector('img');
    expect(logo).toHaveAttribute('src', LOGO);
    expect(logo).toHaveAttribute('alt', '');
  });

  it('lets the logo carry the name when the name is not written', () => {
    render(<BrandMark name="Northwind Wealth" logoDataUrl={LOGO} showName={false} />);
    expect(screen.getByRole('img', { name: 'Northwind Wealth' })).toHaveAttribute('src', LOGO);
    expect(screen.queryByText('Northwind Wealth')).toBeNull();
  });

  it('draws a monogram when there is no logo', () => {
    const { container, rerender } = render(
      <BrandMark name="northwind Wealth" logoDataUrl={null} />,
    );
    expect(container.querySelector('[data-monogram]')).toHaveTextContent('N');
    expect(container.querySelector('[data-monogram]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('northwind Wealth')).toBeInTheDocument();

    rerender(<BrandMark name="Northwind Wealth" showName={false} />);
    expect(screen.getByRole('img', { name: 'Northwind Wealth' })).toHaveTextContent('N');
  });
});
