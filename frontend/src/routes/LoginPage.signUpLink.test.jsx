import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), chooseAccount: vi.fn(), signInWithIdToken: vi.fn() }),
}));
// No Apple / Google configured: the link has to read right on its own, as it does in production.
vi.mock('../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: () => [],
}));

// "Sign up" is the usual partner of "Log in". Not "Sign up with email": the sign-up page offers Apple
// and Google too, and on this page the Continue-with buttons already sign a new person up.
describe('LoginPage sign-up link', () => {
  it('says "New to Huddle? Sign up" and goes to the sign-up page', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Sign up' });
    expect(link).toHaveAttribute('href', '/register');
    expect(link.parentElement).toHaveTextContent('New to Huddle? Sign up');
    expect(screen.queryByRole('link', { name: 'Register' })).not.toBeInTheDocument();
  });
});
