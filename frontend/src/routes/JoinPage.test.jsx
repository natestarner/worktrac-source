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

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/join${search}`]}>
      <JoinPage />
    </MemoryRouter>,
  );
}

describe('JoinPage', () => {
  const acceptInvite = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    acceptInvite.mockResolvedValue(undefined);
    useAuth.mockReturnValue({ acceptInvite });
  });

  it('accepts the invitation and lands in the app', async () => {
    renderAt('?i=42&t=secret-token');

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

  /**
   * ⚠️ A blank password is a REAL case, not a validation gap. When the invited address already has
   * a Huddle account the server ignores the field entirely — and the client cannot know which case
   * it is in, because an endpoint that answered "does this address have an account" would be the
   * exact user-enumeration oracle the invite design exists to avoid.
   */
  it('submits with no password at all, for someone who already has an account', async () => {
    renderAt('?i=42&t=secret-token');

    fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

    await waitFor(() =>
      expect(acceptInvite).toHaveBeenCalledWith({
        inviteId: '42',
        token: 'secret-token',
        password: undefined,
      }),
    );
  });

  // A too-short entry must be caught here, not just on the server -- the placeholder says "at
  // least 8 characters" but nothing previously enforced it client-side.
  it('rejects a too-short password without calling the server', async () => {
    renderAt('?i=42&t=secret-token');

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  // A truncated link (mail clients do wrap and cut them) is not a server refusal, so it must not
  // become a network call. Says what to do rather than what is wrong with the URL.
  it('explains a link that is missing its parts, without calling the server', async () => {
    renderAt('?i=42');

    expect(screen.getByRole('alert')).toHaveTextContent(/missing part of its address/i);
    expect(screen.queryByRole('button', { name: 'Join household' })).not.toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and stays put', async () => {
    acceptInvite.mockRejectedValue(new Error('That invitation link is no longer valid. Ask for a new one.'));
    renderAt('?i=42&t=stale');

    fireEvent.click(screen.getByRole('button', { name: 'Join household' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
