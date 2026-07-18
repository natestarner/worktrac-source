import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  confirmEmail as apiConfirmEmail,
  login as apiLogin,
  me as apiMe,
  register as apiRegister,
  requestPasswordReset as apiRequestPasswordReset,
  resendCode as apiResendCode,
  resendResetCode as apiResendResetCode,
  resetPassword as apiResetPassword,
} from '../api/auth';
import { getAuthToken, setAuthToken, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

const EMPTY = { status: 'loading', user: null, account: null, people: [] };

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ status: 'unauthenticated', user: null, account: null, people: [] });
      navigate('/login');
    });
  }, [navigate]);

  useEffect(() => {
    if (!getAuthToken()) {
      setState({ status: 'unauthenticated', user: null, account: null, people: [] });
      return;
    }
    apiMe()
      .then((data) => setState({ status: 'authenticated', ...data }))
      .catch(() => setState({ status: 'unauthenticated', user: null, account: null, people: [] }));
  }, []);

  const login = useCallback(async (email, password) => {
    const { token } = await apiLogin({ email, password });
    setAuthToken(token);
    const data = await apiMe();
    setState({ status: 'authenticated', ...data });
  }, []);

  // Starts the pending registration (sends a verification code) -- no account exists yet, so
  // this does not log the user in. That happens in confirmEmail below, once the code checks
  // out and the account is actually created.
  const register = useCallback(async (payload) => {
    return apiRegister(payload);
  }, []);

  const confirmEmail = useCallback(async ({ email, code }) => {
    const { token } = await apiConfirmEmail({ email, code });
    setAuthToken(token);
    const data = await apiMe();
    setState({ status: 'authenticated', ...data });
  }, []);

  const resendCode = useCallback(async ({ email }) => {
    return apiResendCode({ email });
  }, []);

  // Does not log the user in -- reset requires re-entering the new password at /login
  // afterward, same as any other password change.
  const requestPasswordReset = useCallback(async ({ email }) => {
    return apiRequestPasswordReset({ email });
  }, []);

  const resetPassword = useCallback(async ({ email, code, password }) => {
    return apiResetPassword({ email, code, password });
  }, []);

  const resendResetCode = useCallback(async ({ email }) => {
    return apiResendResetCode({ email });
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setState({ status: 'unauthenticated', user: null, account: null, people: [] });
  }, []);

  // /api/auth/me returns account+people together; used both after adding/removing a
  // person and after changing the account's default unit in Admin.
  const refreshPeople = useCallback(async () => {
    const data = await apiMe();
    setState((s) => ({ ...s, account: data.account, people: data.people }));
  }, []);

  const isAdmin = state.user?.role === 'ADMIN';

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAdmin,
        login,
        register,
        confirmEmail,
        resendCode,
        requestPasswordReset,
        resetPassword,
        resendResetCode,
        logout,
        refreshPeople,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
