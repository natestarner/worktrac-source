import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from './RegisterPage';
import { useAuth } from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderPage(initialEntry = '/register') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe('RegisterPage validation', () => {
  let register;

  beforeEach(() => {
    vi.clearAllMocks();
    register = vi.fn().mockResolvedValue({ email: 'alex@example.com' });
    useAuth.mockReturnValue({ register });
  });

  it('shows inline errors and does not submit when required fields are blank', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('clears a field error once the user types', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    expect(screen.queryByText('Enter your name.')).not.toBeInTheDocument();
  });

  it('registers then navigates to /confirm-email with the email in state, not /app/log', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        accountName: '',
        email: 'alex@example.com',
        password: 'password123',
        personName: 'Alex',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
      state: { email: 'alex@example.com', wantsPlan: null },
    });
  });

  // marketing/index.html's "Go Plus" button links to /register?plan=plus. The parameter is a hint
  // about where to land after confirming an email -- it grants nothing, so anything other than the
  // exact value is ignored rather than treated as intent.
  it('carries ?plan=plus through to confirm-email so the household lands on billing', async () => {
    renderPage('/register?plan=plus');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
        state: { email: 'alex@example.com', wantsPlan: 'PLUS' },
      }),
    );
  });

  // ⚠️ This is the case that was broken in production. marketing/for-trainers.html's three CTAs all
  // link to /register?plan=pro, and this page understood only 'plus' -- so every trainer who
  // clicked one was treated as having named no plan at all and dropped on Log, while a family
  // clicking "Go Plus" was carried to billing. Nothing threw and nothing 404'd; the param was
  // simply read as absent, which is why it survived a page that otherwise had e2e coverage
  // asserting the links carried plan=pro.
  it('carries ?plan=pro through to confirm-email so a trainer lands on billing', async () => {
    renderPage('/register?plan=pro');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
        state: { email: 'sam@example.com', wantsPlan: 'PRO' },
      }),
    );
  });

  // ⚠️ THE BUG: a trainer arriving from for-trainers.html saw "household" throughout this page --
  // the heading, the field label, the button -- and a client they later invited read it back in
  // their OWN invite email, because a blank field fell through to RegistrationService's
  // `personName + "'s Household"` default regardless of intent. Every literal "household" on this
  // page must flip to "account" for a Pro-intent arrival, and a blank field must submit this
  // page's OWN default rather than leaving it for the backend to household-flavor.
  describe('a Pro-intent arrival (?plan=pro) never says "household"', () => {
    it('relabels the heading, the field, the button and the legal line', () => {
      renderPage('/register?plan=pro');

      expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
      expect(screen.getByLabelText('Account name (optional)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
      expect(screen.getByText(/By creating an account, you agree to our/)).toBeInTheDocument();

      expect(screen.queryByText(/household/i)).not.toBeInTheDocument();
    });

    it('previews and then SENDS its own default, rather than falling through to the household one', async () => {
      renderPage('/register?plan=pro');

      const accountField = screen.getByLabelText('Account name (optional)');
      expect(accountField).toHaveAttribute('placeholder', 'Defaults to your account');

      fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Sam' } });
      expect(accountField).toHaveAttribute('placeholder', "Defaults to “Sam's Account”");

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'sam@example.com' } });
      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() =>
        expect(register).toHaveBeenCalledWith({
          accountName: "Sam's Account",
          email: 'sam@example.com',
          password: 'password123',
          personName: 'Sam',
        }),
      );
    });

    // Typing a real name still wins over the computed default -- this page only fills the gap a
    // blank field would otherwise leave for the backend.
    it('still sends a typed account name untouched', async () => {
      renderPage('/register?plan=pro');

      fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Sam' } });
      fireEvent.change(screen.getByLabelText('Account name (optional)'), { target: { value: 'Iron Peak Training' } });
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'sam@example.com' } });
      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() =>
        expect(register).toHaveBeenCalledWith(
          expect.objectContaining({ accountName: 'Iron Peak Training' }),
        ),
      );
    });
  });

  // The control case: ?plan=plus (a family) and no plan at all must keep the original household
  // copy and the original server-default behaviour (a blank field submitted as-is).
  it('keeps "household" copy for a non-Pro arrival', () => {
    renderPage('/register?plan=plus');

    expect(screen.getByRole('heading', { name: 'Create your household' })).toBeInTheDocument();
    expect(screen.getByLabelText('Household name (optional)')).toBeInTheDocument();
  });

  it('ignores a plan parameter that names neither paid plan', async () => {
    renderPage('/register?plan=PLUS&plan=enterprise');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
        state: { email: 'alex@example.com', wantsPlan: null },
      }),
    );
  });

  // The lookup key comes straight off a URL, so it must not reach Object.prototype. Against a
  // plain object literal `?plan=toString` resolves to an inherited function -- truthy, and so read
  // as a named plan, sending someone who named nothing to billing. It grants nothing either way,
  // but "a query string can pick a member off Object.prototype" is worth never relying on.
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
    'does not read ?plan=%s as a named plan',
    async (key) => {
      renderPage(`/register?plan=${key}`);

      fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
          state: { email: 'alex@example.com', wantsPlan: null },
        }),
      );
    },
  );

  // Registration previously made no mention of Terms/Privacy at all -- the point someone most
  // needs them, since it's the moment they're agreeing to something.
  it('links to Terms and Privacy Policy, each opening in a new tab', () => {
    renderPage();

    const terms = screen.getByRole('link', { name: 'Terms' });
    expect(terms).toHaveAttribute('href', 'https://huddle.fitness/terms.html');
    expect(terms).toHaveAttribute('target', '_blank');

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://huddle.fitness/privacy.html',
    );
  });

  // The household placeholder was the literal string "Defaults to “{name}'s Household”" -- a plain
  // JSX attribute, so `{name}` was never interpolated and every new household saw the braces on
  // screen. It must also stay in step with RegistrationService, which builds the default as
  // `personName + "'s Household"` whenever the field is left blank.
  it('derives the household placeholder from the typed name, with no literal braces', () => {
    renderPage();

    const householdField = screen.getByLabelText('Household name (optional)');
    expect(householdField).toHaveAttribute('placeholder', 'Defaults to your household');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });

    expect(householdField).toHaveAttribute('placeholder', "Defaults to “Alex's Household”");
    expect(householdField.getAttribute('placeholder')).not.toContain('{name}');
  });

  // Every field must be reachable by its visible label: tapping the label focuses the input on an
  // iPad, and a screen reader announces a named field instead of an anonymous one. Only LoginPage
  // wired htmlFor/id before this; the other four auth pages had labels that pointed at nothing.
  it('associates every label with its input', () => {
    renderPage();

    expect(screen.getByLabelText('Your name')).toBe(screen.getByPlaceholderText('e.g. Alex'));
    expect(screen.getByLabelText('Email')).toBe(screen.getByPlaceholderText('you@example.com'));
    expect(screen.getByLabelText('Password')).toBe(screen.getByPlaceholderText('At least 8 characters'));
    expect(screen.getByLabelText('Household name (optional)')).toBeInTheDocument();
  });

  it('shows the server error banner and does not navigate when register fails', async () => {
    register.mockRejectedValue(new Error('An account with that email already exists'));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'dupe@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    expect(await screen.findByText('An account with that email already exists')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
