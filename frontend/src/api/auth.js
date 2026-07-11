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

export function login({ email, password }) {
  return apiClient.post('/api/auth/login', { email, password });
}

export function me() {
  return apiClient.get('/api/auth/me');
}
