import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HelpTab from './HelpTab';
import { useUI } from '../../context/UIContext';
import { getSocialSignInConfig } from '../../config';

// The handbook describes Sign in with Apple / Google only where this environment offers it. Both
// variants pinned: production carries no provider config until launch, and its handbook must say
// exactly what it always did -- including that deleting the account asks for your password.
vi.mock('../../config', async (importOriginal) => ({
  ...(await importOriginal()),
  getSocialSignInConfig: vi.fn(),
}));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ client: null }) }));

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpTab />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useUI.mockReturnValue({ startTour: vi.fn() });
  getSocialSignInConfig.mockReturnValue({});
  delete window.__huddleTestIdentityProvider;
});

describe('HelpTab and Sign in with Apple / Google', () => {
  it('says nothing about Apple or Google where no provider is configured', () => {
    renderHelp();
    expect(screen.queryByText(/Continue with/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in with/)).not.toBeInTheDocument();
    expect(screen.getByText(/enter your password, so a device someone left signed in/)).toBeInTheDocument();
  });

  it('explains it, and how deleting confirms with Apple, where both are offered', () => {
    getSocialSignInConfig.mockReturnValue({
      apple: { servicesId: 'fitness.huddle.web', redirectUri: 'https://x/auth/apple' },
      google: { webClientId: 'web.apps.googleusercontent.com' },
    });
    renderHelp();
    expect(screen.getByText('Continue with Apple or Google')).toBeInTheDocument();
    expect(screen.getByText(/never joins two logins just/)).toBeInTheDocument();
    expect(screen.getByText(/deleting also\s+disconnects Huddle from your Apple ID/)).toBeInTheDocument();
    expect(screen.getByText(/You already have a Huddle login for this email/)).toBeInTheDocument();
  });

  // The e2e stand-in must never be named to a reader, even where its hook is installed.
  it('never names the test provider', () => {
    getSocialSignInConfig.mockReturnValue({ test: true });
    window.__huddleTestIdentityProvider = vi.fn();
    renderHelp();
    expect(screen.queryByText(/Test provider/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue with/)).not.toBeInTheDocument();
  });
});
