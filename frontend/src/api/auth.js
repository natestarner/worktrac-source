import { apiClient } from './client';

// Starts the pending registration and sends a verification code -- no account exists yet,
// so this resolves to { email } rather than a token. See confirmEmail below.
export function register({ accountName, email, password, personName }) {
  return apiClient.post('/api/auth/register', { accountName, email, password, personName });
}

// Only this call actually creates the account and returns the login token/user/account/person
// shape that register() used to return directly.
export function confirmEmail({ email, code }) {
  return apiClient.post('/api/auth/confirm-email', { email, code });
}

export function resendCode({ email }) {
  return apiClient.post('/api/auth/resend-code', { email });
}

// Always resolves, even for an email with no account -- the backend response is deliberately
// generic so this endpoint can't be used to discover which emails are registered.
export function requestPasswordReset({ email }) {
  return apiClient.post('/api/auth/forgot-password', { email });
}

export function resetPassword({ email, code, password }) {
  return apiClient.post('/api/auth/reset-password', { email, code, password });
}

export function resendResetCode({ email }) {
  return apiClient.post('/api/auth/resend-reset-code', { email });
}

export function login({ email, password }) {
  return apiClient.post('/api/auth/login', { email, password });
}

export function me() {
  return apiClient.get('/api/auth/me');
}
