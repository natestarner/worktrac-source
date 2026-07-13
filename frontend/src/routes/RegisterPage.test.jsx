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

function renderPage() {
  return render(
    <MemoryRouter>
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
    expect(mockNavigate).toHaveBeenCalledWith('/confirm-email', { state: { email: 'alex@example.com' } });
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
