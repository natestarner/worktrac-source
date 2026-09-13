import { apiClient, AUTH_TIMEOUT_MS } from './client';

// The three calls that mint a session get the longer bound (see AUTH_TIMEOUT_MS in client.js): they
// are the only requests in the app with nothing cached to fall back on, so aborting one produces a
// dead end rather than a degraded-but-working screen. Everything else here -- register, the resend
// and password-reset calls -- keeps the shared 15s default: each is a step the person can simply
// repeat, and none of them leaves state behind on the device.

// Starts the pending registration and sends a verification code -- no account exists yet,
// so this resolves to { email } rather than a token. See confirmEmail below.
export function register({ accountName, email, password, personName }) {
  return apiClient.post('/api/auth/register', { accountName, email, password, personName });
}

// Only this call actually creates the account and returns the login token/user/account/person
// shape that register() used to return directly.
export function confirmEmail({ email, code }) {
  return apiClient.post('/api/auth/confirm-email', { email, code }, { timeoutMs: AUTH_TIMEOUT_MS });
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
  return apiClient.post('/api/auth/login', { email, password }, { timeoutMs: AUTH_TIMEOUT_MS });
}

// Turns a chosen household into a real session. Two situations reach it:
//   - finishing a login that resolved to two or more households, carrying the five-minute
//     selection token /login handed back;
//   - switching household later, carrying an ordinary session token.
// Both are already-proved identity, so neither takes a password.
//
// AUTH_TIMEOUT_MS for the same reason login has it: this MINTS the session, so there is nothing
// cached behind it. An abort here is not a degraded screen, it is a person stranded on a picker.
// selectionToken is passed per-call rather than stored -- see client.js's bearerOverride for why
// a token that is not a session must never reach localStorage. Omitted when switching household,
// where the stored session token is exactly the right credential.
export function startSession({ accountId, selectionToken }) {
  return apiClient.post('/api/auth/session', { accountId },
    { timeoutMs: AUTH_TIMEOUT_MS, bearerOverride: selectionToken });
}

export function me() {
  return apiClient.get('/api/auth/me');
}
