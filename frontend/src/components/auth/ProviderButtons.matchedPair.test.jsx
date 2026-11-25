import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderButtons from './ProviderButtons';
import { availableSignInProviders, googleUsesRenderedButton } from '../../lib/native';

vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: vi.fn(),
  googleUsesRenderedButton: vi.fn(),
  prepareSignIn: vi.fn(() => Promise.resolve()),
  renderGoogleButton: vi.fn(() => () => {}),
}));

// The sign-in buttons are one matched set: the same white, outlined pill for Apple and Google, the
// way every app we compared draws them. On the web Google draws its own (a 44px pill, at most 400px
// wide), so Apple takes that exact box. In the app both are ours and stay the primary button's size,
// which is what Apple's "no smaller than the other ways to sign in" asks of the App Store build
// (SocialSignIn.test.jsx pins that half).
describe('the Apple and Google buttons as a pair', () => {
  beforeEach(() => vi.clearAllMocks());

  it("on the web, Apple takes the box of Google's own button", () => {
    availableSignInProviders.mockReturnValue(['apple', 'google']);
    googleUsesRenderedButton.mockReturnValue(true);
    render(<ProviderButtons onToken={vi.fn()} size="large" />);

    const apple = screen.getByRole('button', { name: 'Continue with Apple' });
    expect(apple).not.toHaveClass('btn-lg');
    expect(apple.style.height).toBe('44px');
    expect(apple.style.maxWidth).toBe('400px');
    expect(apple.style.borderRadius).toBe('var(--radius-full)');
    // "White with outline", in Google's outline colour, so the two edges match.
    expect(apple.style.background).toMatch(/#fff|rgb\(255, 255, 255\)/);
    expect(apple.style.border).toMatch(/#dadce0|rgb\(218, 220, 224\)/);
  });

  it('on the web with no Google button, Apple keeps the full size', () => {
    availableSignInProviders.mockReturnValue(['apple']);
    googleUsesRenderedButton.mockReturnValue(true);
    render(<ProviderButtons onToken={vi.fn()} size="large" />);

    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toHaveClass('btn', 'btn-lg', 'btn-full');
  });

  it('in the app, both are ours: the same full-size pill, in the same colours', () => {
    availableSignInProviders.mockReturnValue(['apple', 'google']);
    googleUsesRenderedButton.mockReturnValue(false);
    render(<ProviderButtons onToken={vi.fn()} size="large" />);

    const apple = screen.getByRole('button', { name: 'Continue with Apple' });
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    for (const button of [apple, google]) {
      expect(button).toHaveClass('btn', 'btn-lg', 'btn-full');
      expect(button.style.borderRadius).toBe('var(--radius-full)');
      expect(button.style.border).toBe(apple.style.border);
      expect(button.style.background).toBe(apple.style.background);
    }
  });
});
