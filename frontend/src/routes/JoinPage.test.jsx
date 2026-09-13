import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JoinPage from './JoinPage';
import { useAuth } from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const SET_PASSWORD = {
  mode: 'SET_PASSWORD',
  householdName: 'the Starner household',
  personName: 'Sam',
  email: 'sam@example.com',
};
const SIGN_IN = { ...SET_PASSWORD, mode: 'SIGN_IN' };

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/join${search}`]}>
      <JoinPage />
    </MemoryRouter>,
  );
}

describe('JoinPage', () => {
  const acceptInvite = vi.fn();
  const previewInvite = vi.fn();
  const chooseHousehold = vi.fn();
  const logout = vi.fn();

  function signedInAs(email) {
    useAuth.mockReturnValue({
      acceptInvite,
      previewInvite,
      chooseHousehold,
      logout,
      status: email ? 'authenticated' : 'unauthenticated',
      user: email ? { email } : null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    acceptInvite.mockResolvedValue(null);
    previewInvite.mockResolvedValue(SET_PASSWORD);
    signedInAs(null);
  });

  describe('a brand-new address', () => {
    it('asks for a password to set, and lands in the app', async () => {
      renderAt('?i=42&t=secret-token');

      expect(await screen.findByPlaceholderText('At least 8 characters')).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      await waitFor(() =>
        expect(acceptInvite).toHaveBeenCalledWith({
          inviteId: '42',
          token: 'secret-token',
          password: 'password123',
        }),
      );
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/log'));
    });

    // A too-short entry must be caught here, not just on the server.
    it('rejects a too-short password without calling the server', async () => {
      renderAt('?i=42&t=secret-token');

      fireEvent.change(await screen.findByPlaceholderText('At least 8 characters'), {
        target: { value: 'short' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
      expect(acceptInvite).not.toHaveBeenCalled();
    });
  });

  describe('an address that already has an account', () => {
    beforeEach(() => previewInvite.mockResolvedValue(SIGN_IN));

    /**
     * ⚠️ The screen must ask them to SIGN IN, not to choose a password.
     *
     * It used to offer one password field to everybody with the instruction to "leave it blank"
     * if you already had an account — which contradicted the invitation email, and, worse, was
     * describing a server that ignored the field entirely and handed over a full session on the
     * strength of the link alone.
     */
    it('asks for the password they already have, never a new one', async () => {
      renderAt('?i=42&t=secret-token');

      const field = await screen.findByPlaceholderText('Your Huddle password');
      expect(field).toHaveAttribute('autocomplete', 'current-password');
      expect(screen.queryByPlaceholderText('At least 8 characters')).not.toBeInTheDocument();
      // Which address was invited is the difference between "this is mine" and "wrong person".
      expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
      expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
      // A password they cannot remember needs a way out that is not "ask for another invite".
      expect(screen.getByRole('link', { name: /forgot your password/i })).toBeInTheDocument();

      fireEvent.change(field, { target: { value: 'their-real-password' } });
      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      await waitFor(() =>
        expect(acceptInvite).toHaveBeenCalledWith({
          inviteId: '42',
          token: 'secret-token',
          password: 'their-real-password',
        }),
      );
    });

    /**
     * The reason the whole flow needs no journey of its own: joining leaves this credential in two
     * households, so the answer to "which one now?" is the picker they would have met on their
     * next sign-in anyway.
     */
    it('shows the shared household picker when joining leaves them in two', async () => {
      acceptInvite.mockResolvedValue({
        households: [
          { accountId: 1, accountName: 'Sam’s house', accountRole: 'OWNER' },
          { accountId: 2, accountName: 'the Starner household', accountRole: 'MEMBER' },
        ],
        selectionToken: 'five-minute-token',
      });
      renderAt('?i=42&t=secret-token');

      fireEvent.change(await screen.findByPlaceholderText('Your Huddle password'), {
        target: { value: 'their-real-password' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      expect(await screen.findByRole('button', { name: /Sam’s house/ })).toBeInTheDocument();
      // Not navigated anywhere yet -- the whole point is that nothing moves them without asking.
      expect(mockNavigate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /the Starner household/ }));

      await waitFor(() => expect(chooseHousehold).toHaveBeenCalledWith(2, 'five-minute-token'));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/log'));
    });
  });

  describe('somebody who is already signed in', () => {
    beforeEach(() => previewInvite.mockResolvedValue(SIGN_IN));

    it('joins with no password when the invitation is for them', async () => {
      signedInAs('sam@example.com');
      renderAt('?i=42&t=secret-token');

      expect(await screen.findByText(/You’re signed in as/)).toBeInTheDocument();
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      await waitFor(() =>
        expect(acceptInvite).toHaveBeenCalledWith({
          inviteId: '42',
          token: 'secret-token',
          password: undefined,
        }),
      );
    });

    // The invited address is normalised to lower case server-side; a session's email is whatever
    // was typed at registration. Same person either way.
    it('matches the invited address case-insensitively', async () => {
      signedInAs('Sam@Example.com');
      renderAt('?i=42&t=secret-token');

      expect(await screen.findByRole('button', { name: 'Join household' })).toBeInTheDocument();
      expect(screen.queryByText(/but you’re signed in as/)).not.toBeInTheDocument();
    });

    /**
     * ⚠️ NEVER SILENTLY SWAP IDENTITY. Accepting replaced the signed-in session wholesale, so
     * opening Sam's link on Nate's iPad signed Nate out and Sam in with no confirmation and
     * nothing on screen to explain it. Both doors, named, and neither taken automatically.
     */
    it('names both addresses instead of swapping identity, when the invitation is for somebody else', async () => {
      signedInAs('nate@example.com');
      renderAt('?i=42&t=secret-token');

      expect(await screen.findByText(/This invitation is for/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in as sam@example.com' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stay signed in as nate@example.com' })).toBeInTheDocument();
      // Nothing offered to accept it as the wrong person.
      expect(screen.queryByRole('button', { name: 'Join household' })).not.toBeInTheDocument();
      expect(acceptInvite).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Stay signed in as nate@example.com' }));
      expect(logout).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    });
  });

  describe('when the link or the network is the problem', () => {
    // A truncated link (mail clients do wrap and cut them) is not a server refusal, so it must not
    // become a network call.
    it('explains a link that is missing its parts, without calling the server', async () => {
      renderAt('?i=42');

      expect(screen.getByRole('alert')).toHaveTextContent(/missing part of its address/i);
      expect(screen.queryByRole('button', { name: 'Join household' })).not.toBeInTheDocument();
      expect(previewInvite).not.toHaveBeenCalled();
      expect(acceptInvite).not.toHaveBeenCalled();
    });

    it('shows the server’s refusal and stays put', async () => {
      acceptInvite.mockRejectedValue(new Error('That invitation link is no longer valid. Ask for a new one.'));
      renderAt('?i=42&t=stale');

      fireEvent.change(await screen.findByPlaceholderText('At least 8 characters'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('reports a refused invitation as refused', async () => {
      previewInvite.mockRejectedValue(
        Object.assign(new Error('That invitation link is no longer valid. Ask for a new one.'), { status: 403 }),
      );
      renderAt('?i=42&t=stale');

      expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
    });

    /**
     * ⚠️ A link we could not CHECK is not a link we know to be bad.
     *
     * `isOfflineError` treats a status-less failure AND any 5xx as unreachable. Lower runs
     * min-replicas=0 with a measured ~35s cold start, and a DB outage answers an honest 503, so
     * this is a routine occurrence — and telling somebody holding a perfectly valid invitation
     * that it is "no longer valid" sends them to ask for another one they do not need.
     *
     * ⚠️ Asserted with a 503 whose message is the server's own, deliberately. A status-less abort
     * would ALSO be correct behaviour, but api/client.js rewrites those to the very sentence this
     * branch produces — so that version of the test passes whether the branch exists or not, and
     * proves nothing. Verified non-vacuous: force the branch false and this fails.
     */
    it('does not call a link invalid when it could not reach the server at all', async () => {
      previewInvite.mockRejectedValue(
        Object.assign(new Error('Something went wrong on our end. Try again in a moment.'), { status: 503 }),
      );
      renderAt('?i=42&t=secret-token');

      expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t reach huddle to check this invitation/i);
      expect(screen.getByRole('alert')).not.toHaveTextContent(/no longer valid/i);
    });
  });
});
