import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { confirmEmail as apiConfirmEmail, me as apiMe, register as apiRegister } from '../api/auth';
import { getAuthToken, setAuthToken } from '../api/client';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  me: vi.fn(),
  register: vi.fn(),
  confirmEmail: vi.fn(),
  resendCode: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getAuthToken: vi.fn(() => null),
  setAuthToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

// register() only starts the pending registration (no account exists yet); confirmEmail() is
// what actually logs the user in, once the code checks out and the account gets created.
function Harness() {
  const { status, register, confirmEmail } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={() => register({ email: 'alex@example.com', password: 'password123', personName: 'Alex' })}>
        register
      </button>
      <button onClick={() => confirmEmail({ email: 'alex@example.com', code: '123456' })}>confirm</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthContext register/confirmEmail split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthToken.mockReturnValue(null);
  });

  it('register starts the pending registration but does not store a token or authenticate', async () => {
    apiRegister.mockResolvedValue({ email: 'alex@example.com' });
    renderHarness();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('register'));

    await waitFor(() =>
      expect(apiRegister).toHaveBeenCalledWith({
        email: 'alex@example.com',
        password: 'password123',
        personName: 'Alex',
      }),
    );
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(apiMe).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('confirmEmail stores the token and authenticates the user', async () => {
    apiConfirmEmail.mockResolvedValue({ token: 'tok-123' });
    apiMe.mockResolvedValue({ user: { email: 'alex@example.com' }, account: { id: 1 }, people: [{ id: 1 }] });
    renderHarness();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('confirm'));

    await waitFor(() =>
      expect(apiConfirmEmail).toHaveBeenCalledWith({ email: 'alex@example.com', code: '123456' }),
    );
    expect(setAuthToken).toHaveBeenCalledWith('tok-123');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
  });
});
