import { apiClient, AUTH_TIMEOUT_MS } from './client';

// Sign in with Apple / Google. docs/architecture/social-sign-in.md has the server's side.
//
// AUTH_TIMEOUT_MS on every call that MINTS a session (sign-in, disconnect, setting a first
// password), for login's reason: a credential operation has nothing cached behind it, and lower's
// cold start is ~35s with the connection held (resilience.md's register).

/**
 * The provider's token for a session. Same two shapes as /login (session, or the household picker),
 * or a 409 with code SIGN_UP_REQUIRED for a new person: ask their name and call again with it.
 */
export function signInWithIdToken(provider, { idToken, nonce, personName, accountName }) {
  return apiClient.post(`/api/auth/oauth/${provider}`, { idToken, nonce, personName, accountName },
    { timeoutMs: AUTH_TIMEOUT_MS });
}

/** { hasPassword, connected: [{ provider, connectedAt, lastUsedAt }], available: ['apple', ...] } */
export function getSignInMethods() {
  return apiClient.get('/api/user/sign-in-methods');
}

export function connectSignInMethod(provider, { idToken, nonce }) {
  return apiClient.post(`/api/user/sign-in-methods/${provider}`, { idToken, nonce },
    { timeoutMs: AUTH_TIMEOUT_MS });
}

/** Returns a REPLACEMENT session -- it signs out every other device. Use AuthContext's wrapper. */
export function disconnectSignInMethod(provider) {
  return apiClient.delete(`/api/user/sign-in-methods/${provider}`, undefined, { timeoutMs: AUTH_TIMEOUT_MS });
}

/** A login with no password sets its first one, proving itself with a provider. Returns a session. */
export function setInitialPassword({ newPassword, reconfirmation }) {
  return apiClient.post('/api/user/password/initial', { newPassword, reconfirmation },
    { timeoutMs: AUTH_TIMEOUT_MS });
}
