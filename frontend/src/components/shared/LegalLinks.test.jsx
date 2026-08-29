import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LegalLinks, { PRIVACY_URL, TERMS_URL } from './LegalLinks';

describe('LegalLinks', () => {
  it('links to the marketing site\'s Terms and Privacy pages, each opening in a new tab', () => {
    render(<LegalLinks />);

    const terms = screen.getByRole('link', { name: 'Terms' });
    expect(terms).toHaveAttribute('href', TERMS_URL);
    expect(terms).toHaveAttribute('target', '_blank');
    expect(terms).toHaveAttribute('rel', 'noopener noreferrer');

    const privacy = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(privacy).toHaveAttribute('href', PRIVACY_URL);
    expect(privacy).toHaveAttribute('target', '_blank');
    expect(privacy).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('lets a caller supply its own surrounding separator text', () => {
    const { container } = render(<LegalLinks separator=", " />);

    expect(container.textContent).toBe('Terms, Privacy Policy');
  });
});
