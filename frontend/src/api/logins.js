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

// Removing a login, or withdrawing an invitation that was never accepted -- one call for both,
// because the owner should not have to know which state somebody was in to undo it.
//
// 204 whether or not there was anything to revoke: the intent ("this person should not have a
// login") is true either way, and a 404 would only invite a retry.
export function revokeLogin(personId) {
  return apiClient.delete(`/api/account/logins/${personId}`);
}

// Clears a member's login lockout. The owner acting as the support desk -- a teenager locked out
// mid-workout asks the person standing next to them, not their inbox.
//
// It grants nothing: a lockout is a throttle on guessing, not a credential, so clearing it cannot
// let the owner in as that member. That is exactly why an owner may do this and may never set a
// password. 204 whether or not they were locked.
export function unlockLogin(personId) {
  return apiClient.post(`/api/account/logins/${personId}/unlock`);
}
