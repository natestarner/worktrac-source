import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignInMethodsSection from './SignInMethodsSection';
import { useSignInMethods } from '../../hooks/useSignInMethods';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1 }, disconnectSignInMethod: vi.fn() }),
}));
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast: vi.fn(), openConfirm: vi.fn() }) }));
vi.mock('../../hooks/useSignInMethods', () => ({ useSignInMethods: vi.fn() }));
vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: () => ['apple', 'google'],
  googleUsesRenderedButton: () => false,
}));

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SignInMethodsSection />
    </QueryClientProvider>,
  );
}

describe('SignInMethodsSection', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });

  // A connected provider is shown with its own mark, as most apps show "connected accounts" -- not
  // as a bare word. The test provider has no logo, and must not get an empty one.
  it('shows each connected provider with its logo beside its name', () => {
    useSignInMethods.mockReturnValue({
      data: {
        hasPassword: true,
        connected: [
          { provider: 'google', connectedAt: '2026-11-11T12:00:00Z' },
          { provider: 'apple', connectedAt: '2026-11-11T12:00:00Z' },
          { provider: 'test', connectedAt: '2026-11-11T12:00:00Z' },
        ],
        available: ['apple', 'google'],
      },
    });
    renderSection();

    for (const name of ['Google', 'Apple']) {
      const row = screen.getByText(name, { selector: 'span' }).parentElement;
      expect(row.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    const testRow = screen.getByText('Test provider', { selector: 'span' }).parentElement;
    expect(testRow.querySelector('svg')).toBeNull();
  });
});
