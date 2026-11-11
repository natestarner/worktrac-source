import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SocialSignIn from './SocialSignIn';
import { useAuth } from '../../context/AuthContext';
import { availableSignInProviders, signInWithProvider } from '../../lib/native';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/native', () => ({
  availableSignInProviders: vi.fn(),
  googleUsesRenderedButton: () => false,
  renderGoogleButton: vi.fn(),
  signInWithProvider: vi.fn(),
}));

function apiError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

describe('SocialSignIn', () => {
  let signInWithIdToken;
  const token = { idToken: 'id-token', nonce: 'raw-nonce', givenName: 'Sam' };

  beforeEach(() => {
    vi.clearAllMocks();
    availableSignInProviders.mockReturnValue(['apple', 'google']);
    signInWithProvider.mockResolvedValue(token);
    signInWithIdToken = vi.fn();
    useAuth.mockReturnValue({ signInWithIdToken });
  });

  it('renders nothing where no provider is configured, so the page is unchanged', () => {
    availableSignInProviders.mockReturnValue([]);
    const { container } = render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('signs in and hands over to the page', async () => {
    signInWithIdToken.mockResolvedValue(null);
    const onSignedIn = vi.fn();
    render(<SocialSignIn onSignedIn={onSignedIn} onNeedsChoice={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signInWithIdToken).toHaveBeenCalledWith('apple', { idToken: 'id-token', nonce: 'raw-nonce' });
  });

  it('passes the household picker up', async () => {
    const choice = { accounts: [{ accountId: 1 }, { accountId: 2 }], selectionToken: 'sel' };
    signInWithIdToken.mockResolvedValue(choice);
    const onNeedsChoice = vi.fn();
    render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={onNeedsChoice} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(onNeedsChoice).toHaveBeenCalledWith(choice));
  });

  // A new person: ask their name (pre-filled from Apple when it gave one) and resubmit the SAME
  // token and nonce, which the server accepts for its ten-minute life.
  it('asks a new person their name, then resubmits the same token with it', async () => {
    signInWithIdToken
      .mockRejectedValueOnce(apiError(409, 'Tell us your name', 'SIGN_UP_REQUIRED'))
      .mockResolvedValueOnce(null);
    const onSignedIn = vi.fn();
    const onSignUpStep = vi.fn();
    render(<SocialSignIn onSignedIn={onSignedIn} onNeedsChoice={vi.fn()} onSignUpStep={onSignUpStep} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    const name = await screen.findByLabelText('Your name');
    expect(name).toHaveValue('Sam');
    expect(onSignUpStep).toHaveBeenCalledWith(true);

    fireEvent.change(name, { target: { value: 'Samantha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my household' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signInWithIdToken).toHaveBeenLastCalledWith('apple', {
      idToken: 'id-token',
      nonce: 'raw-nonce',
      personName: 'Samantha',
      accountName: undefined,
    });
  });

  it("names a Pro arrival's account '{name}'s Account' when left blank, like RegisterPage", async () => {
    signInWithIdToken
      .mockRejectedValueOnce(apiError(409, 'Tell us your name', 'SIGN_UP_REQUIRED'))
      .mockResolvedValueOnce(null);
    render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} accountNoun="Account" />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    await screen.findByLabelText('Your name');
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    await waitFor(() =>
      expect(signInWithIdToken).toHaveBeenLastCalledWith('apple', expect.objectContaining({ accountName: "Sam's Account" })),
    );
  });

  it("shows the server's words when an email already has a password login", async () => {
    signInWithIdToken.mockRejectedValue(
      apiError(409, 'You already have a Huddle login for this email. Sign in with your password, then connect Apple in Profile.'),
    );
    render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in with your password');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('says nothing when the person closes the sheet', async () => {
    signInWithProvider.mockRejectedValue(Object.assign(new Error('Sign-in cancelled'), { cancelled: true }));
    render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});
