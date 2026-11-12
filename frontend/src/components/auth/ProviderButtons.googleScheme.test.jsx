import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProviderButtons from './ProviderButtons';

vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: () => ['google'],
  googleUsesRenderedButton: () => true,
  renderGoogleButton: vi.fn(() => () => {}),
}));

// Google's button is an iframe holding a light-only document. On a dark page a browser paints an
// opaque white backdrop behind an iframe whose colour scheme differs from the page's -- the white
// box seen around the button in iOS Safari dark mode. The host pins the iframe's scheme to light.
describe("Google's own button", () => {
  it('sits in a light colour-scheme host, so dark mode draws no white box around it', () => {
    render(<ProviderButtons onToken={vi.fn()} />);
    const host = screen.getByLabelText('Continue with Google');
    expect(host.style.getPropertyValue('color-scheme')).toBe('light');
  });
});
