import { apiClient, AUTH_TIMEOUT_MS } from './client';

// The owner's login manager. Both of these are online-only (Tier-3) writes -- an invitation sends
// an email, which has no offline equivalent and must never be queued and replayed.

export function listLogins() {
  return apiClient.get('/api/account/logins');
}

// The response says INVITED whatever the state of the invited address -- deliberately. See
// MembershipInviteService on the backend: an owner-visible difference between "they already had an
// account" and "they did not" is a user-enumeration oracle.
export function inviteLogin(personId, email) {
  return apiClient.post(`/api/account/logins/${personId}/invite`, { email });
}

// Finishing an invitation MINTS a session, so it gets the same longer bound as login and
// confirm-email: there is nothing cached behind it, and an abort leaves someone stranded on a link
// they cannot retry from anywhere else.
//
// `password` is omitted when the invited address already has a Huddle account -- the server ignores
// it in that case, because an invitation must never change somebody's existing credentials.
export function acceptInvite({ inviteId, token, password }) {
  return apiClient.post(
    '/api/auth/accept-invite',
    password ? { inviteId, token, password } : { inviteId, token },
    { timeoutMs: AUTH_TIMEOUT_MS },
  );
}
