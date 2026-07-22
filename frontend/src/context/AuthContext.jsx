import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
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
import { getAuthToken, isOfflineError, setAuthToken, setUnauthorizedHandler } from '../api/client';
import { resetQueryCache } from '../lib/queryClient';
import { clearAuthSnapshot, loadAuthSnapshot, saveAuthSnapshot } from '../lib/authSnapshot';
import { requestPersistentStorage } from '../lib/durableStorage';

const AuthContext = createContext(null);

const EMPTY = { status: 'loading', user: null, account: null, people: [], offline: false };
const SIGNED_OUT = { status: 'unauthenticated', user: null, account: null, people: [], offline: false };

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetQueryCache();
      clearAuthSnapshot();
      setState(SIGNED_OUT);
      navigate('/login');
    });
  }, [navigate]);

  useEffect(() => {
    if (!getAuthToken()) {
      clearAuthSnapshot();
      setState(SIGNED_OUT);
      return;
    }
    apiMe()
      .then((data) => {
        // A verified live session -- record the identity so a later cold start with no network can
        // still boot into the app, and mark durable storage so the offline cache isn't evicted.
        saveAuthSnapshot(data);
        requestPersistentStorage();
        setState({ status: 'authenticated', offline: false, ...data });
      })
      .catch((error) => {
        // Distinguish "session is actually invalid" from "we just couldn't reach the server".
        // A 4xx (esp. 401) is the server's real answer -> sign out. A network/offline/5xx failure
        // with a valid saved token + a last-known identity -> boot the app OFFLINE from the
        // snapshot, so a valid session works with no connectivity instead of bouncing to /login.
        const snapshot = loadAuthSnapshot();
        if (isOfflineError(error) && snapshot) {
          requestPersistentStorage();
          setState({ status: 'authenticated', offline: true, ...snapshot });
        } else {
          clearAuthSnapshot();
          setState(SIGNED_OUT);
        }
      });
  }, []);

  // When connectivity returns after an offline boot, silently reconcile the identity against the
  // server (role/people may have changed) and drop the `offline` flag. A failure here is harmless --
  // we simply stay on the cached identity until the next reconnect.
  useEffect(() => {
    return onlineManager.subscribe((online) => {
      if (!online || !getAuthToken()) return;
      apiMe()
        .then((data) => {
          saveAuthSnapshot(data);
          setState((s) => (s.status === 'authenticated' ? { status: 'authenticated', offline: false, ...data } : s));
        })
        .catch(() => {
          // Still unreachable (server down while network is up) -- keep the cached identity.
        });
    });
  }, []);

  const login = useCallback(async (email, password) => {
    const { token } = await apiLogin({ email, password });
    // Clear any cache left by a previously logged-in household on this device before we start
    // fetching this account's data -- account-shared keys (catalog, tags) carry no accountId.
    resetQueryCache();
    clearAuthSnapshot();
    setAuthToken(token);
    const data = await apiMe();
    saveAuthSnapshot(data);
    requestPersistentStorage();
    setState({ status: 'authenticated', offline: false, ...data });
  }, []);

  // Starts the pending registration (sends a verification code) -- no account exists yet, so
  // this does not log the user in. That happens in confirmEmail below, once the code checks
  // out and the account is actually created.
  const register = useCallback(async (payload) => {
    return apiRegister(payload);
  }, []);

  const confirmEmail = useCallback(async ({ email, code }) => {
    const { token } = await apiConfirmEmail({ email, code });
    resetQueryCache();
    clearAuthSnapshot();
    setAuthToken(token);
    const data = await apiMe();
    saveAuthSnapshot(data);
    requestPersistentStorage();
    setState({ status: 'authenticated', offline: false, ...data });
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
    resetQueryCache();
    clearAuthSnapshot();
    setState(SIGNED_OUT);
  }, []);

  // /api/auth/me returns account+people together; used both after adding/removing a
  // person and after changing the account's default unit in Admin. Keep the offline-boot snapshot
  // in step so a later cold start reflects the latest people/account too.
  const refreshPeople = useCallback(async () => {
    const data = await apiMe();
    saveAuthSnapshot(data);
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
