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
      state: { email: 'alex@example.com', wantsPro: false },
    });
  });

  // marketing/index.html's "Go Pro" button links to /register?plan=pro. The parameter is a hint
  // about where to land after confirming an email -- it grants nothing, so anything other than the
  // exact value is ignored rather than treated as intent.
  it('carries ?plan=pro through to confirm-email so the household lands on billing', async () => {
    renderPage('/register?plan=pro');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
        state: { email: 'alex@example.com', wantsPro: true },
      }),
    );
  });

  it('ignores a plan parameter that is not exactly "pro"', async () => {
    renderPage('/register?plan=PRO&plan=enterprise');

    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', {
        state: { email: 'alex@example.com', wantsPro: false },
      }),
    );
  });

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
