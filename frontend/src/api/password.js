import { apiClient, AUTH_TIMEOUT_MS } from './client';

// Changing your own password from inside a live session.
//
// Online-only (Tier-3): it MINTS a session token, so there is nothing to queue and nothing cached
// behind it -- the same reason switching household is online-only.
//
// AUTH_TIMEOUT_MS rather than the default 15s for the same reason login, confirm-email and
// accept-invite use it: a credential operation has no fallback waiting behind it. A read falls back
// to the cache and a write to the outbox; an aborted password change is just a password change that
// did not happen, on a screen the person then has to work out the state of.
//
// ⚠️ The response is a full session, not a 204. The change bumps token_version and so invalidates
// the very token that made the request -- the caller MUST put the returned token through
// AuthContext.establishSession or their next call 401s on the strength of their own success.
export function changePassword({ currentPassword, newPassword }) {
  return apiClient.post(
    '/api/user/password',
    { currentPassword, newPassword },
    { timeoutMs: AUTH_TIMEOUT_MS },
  );
}
