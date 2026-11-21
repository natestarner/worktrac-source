import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SocialSignIn, { SIGNING_IN_ESCAPE_MS, SIGNING_IN_SLOW_MS } from './SocialSignIn';
import { useAuth } from '../../context/AuthContext';
import { availableSignInProviders, signInWithProvider } from '../../lib/native';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/native', () => ({
  availableSignInProviders: vi.fn(),
  googleUsesRenderedButton: () => false,
  prepareSignIn: () => Promise.resolve(),
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

  // Apple's guidelines (and App Review) want Sign in with Apple no smaller than the screen's other
  // ways to sign in: here "Log in" / "Create household", the large primary button. It takes that
  // button's own classes rather than copying a size, because a copied min-height of 52 measured
  // 6px short on lower ("Log in" is 58: its padding carries it past its own minimum). jsdom has no
  // layout, so the class is what can be pinned here; no inline size may override it.
  it("draws the Apple button with the primary button's own size classes", () => {
    render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);
    const apple = screen.getByRole('button', { name: 'Continue with Apple' });
    expect(apple).toHaveClass('btn', 'btn-lg', 'btn-full');
    for (const property of ['minHeight', 'padding', 'fontSize', 'fontWeight', 'lineHeight']) {
      expect(apple.style[property]).toBe('');
    }
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
    expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
  });

  // Between the provider's sheet closing and the app appearing, the login screen used to sit there
  // looking idle. The overlay covers that gap, and is on screen exactly while our request is in
  // flight: every way that request can end must take it down.
  describe('signing-in overlay', () => {
    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('covers the screen while the sign-in is in flight, and hands over when it lands', async () => {
      const request = deferred();
      signInWithIdToken.mockReturnValue(request.promise);
      const onSignedIn = vi.fn();
      render(<SocialSignIn onSignedIn={onSignedIn} onNeedsChoice={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

      const overlay = await screen.findByTestId('signing-in-overlay');
      expect(screen.getByRole('status')).toHaveTextContent('Signing you in…');
      // Portalled to <body>, so no ancestor of the login card can clip or shrink it.
      expect(overlay.parentElement).toBe(document.body);
      expect(onSignedIn).not.toHaveBeenCalled();

      await act(async () => request.resolve(null));
      expect(onSignedIn).toHaveBeenCalled();
    });

    it('goes away when the sign-in fails (a timeout, a refusal) and the buttons come back', async () => {
      const request = deferred();
      signInWithIdToken.mockReturnValue(request.promise);
      render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
      await screen.findByTestId('signing-in-overlay');

      await act(async () => request.reject(apiError(0, "Couldn't reach Huddle")));

      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach Huddle");
      expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
    });

    it('goes away when the household picker takes over', async () => {
      const request = deferred();
      signInWithIdToken.mockReturnValue(request.promise);
      const onNeedsChoice = vi.fn();
      render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={onNeedsChoice} />);

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
      await screen.findByTestId('signing-in-overlay');

      await act(async () => request.resolve({ accounts: [], selectionToken: 'sel' }));

      expect(onNeedsChoice).toHaveBeenCalled();
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
    });

    it('goes away for a new person, leaves the name step usable, and returns while creating', async () => {
      const first = deferred();
      const second = deferred();
      signInWithIdToken.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
      await screen.findByTestId('signing-in-overlay');
      await act(async () => first.reject(apiError(409, 'Tell us your name', 'SIGN_UP_REQUIRED')));

      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Create my household' }));
      expect(await screen.findByTestId('signing-in-overlay')).toHaveTextContent('Creating your household…');

      await act(async () => second.reject(apiError(500, 'Something went wrong')));
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });

    it('says it is still working only after a while, and leaves no timer behind when it unmounts', async () => {
      vi.useFakeTimers();
      signInWithIdToken.mockReturnValue(new Promise(() => {}));
      const { unmount } = render(<SocialSignIn onSignedIn={vi.fn()} onNeedsChoice={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
      await act(async () => {});
      expect(screen.getByTestId('signing-in-overlay')).not.toHaveTextContent('Still working');

      act(() => vi.advanceTimersByTime(SIGNING_IN_SLOW_MS - 1));
      expect(screen.getByTestId('signing-in-overlay')).not.toHaveTextContent('Still working');
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByTestId('signing-in-overlay')).toHaveTextContent('Still working');

      // The page navigating away on success is an unmount mid-await.
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
    });

    // ⚠️ The worst case: an attempt that NEVER finishes (a stalled response body, an IndexedDB
    // that never answers). The overlay must still have a way out, and the screen behind it must be
    // fully usable afterwards -- including the provider button itself.
    describe('an attempt that never finishes', () => {
      async function startStuckAttempt(onSignedIn = vi.fn(), onNeedsChoice = vi.fn()) {
        vi.useFakeTimers();
        const request = deferred();
        signInWithIdToken.mockReturnValueOnce(request.promise);
        render(<SocialSignIn onSignedIn={onSignedIn} onNeedsChoice={onNeedsChoice} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
        await act(async () => {});
        expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
        return request;
      }

      function startOver() {
        act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS));
        fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
      }

      it('offers "Start over" only once nothing legitimate could still be running', async () => {
        await startStuckAttempt();
        act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS - 1));
        expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
      });

      it('"Start over" takes the overlay down and gives back a working screen', async () => {
        await startStuckAttempt();
        startOver();

        expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('taking longer than it should');
        // Both providers, including the one whose attempt is still hanging.
        expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
      });

      it('a new attempt works normally, and the old one finishing late cannot touch it', async () => {
        const stale = await startStuckAttempt();
        startOver();

        const fresh = deferred();
        signInWithIdToken.mockReturnValueOnce(fresh.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
        await act(async () => {});
        expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();

        // The old attempt failing now must neither drop the new attempt's overlay nor show its error.
        await act(async () => stale.reject(apiError(0, 'Old failure')));
        expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
        expect(screen.queryByText('Old failure')).not.toBeInTheDocument();

        await act(async () => fresh.reject(apiError(0, 'New failure')));
        expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('New failure');
      });

      it('an abandoned attempt that signs in after all still takes the person into the app', async () => {
        const onSignedIn = vi.fn();
        const stale = await startStuckAttempt(onSignedIn);
        startOver();

        await act(async () => stale.resolve(null));
        expect(onSignedIn).toHaveBeenCalledTimes(1);
      });

      it('an abandoned attempt that lands on a picker or the name step is dropped', async () => {
        const onNeedsChoice = vi.fn();
        const stale = await startStuckAttempt(vi.fn(), onNeedsChoice);
        startOver();

        await act(async () => stale.resolve({ accounts: [], selectionToken: 'sel' }));
        expect(onNeedsChoice).not.toHaveBeenCalled();
        expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
      });
    });
  });
});
