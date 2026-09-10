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

// What the /join screen needs before it can ask the right question: whether this address already
// has a Huddle account (so it must SIGN IN) or does not (so it must CHOOSE a password), plus the
// household and person the invitation names.
//
// Gated by the emailed token, not by a session -- and answering it to the holder of a valid link is
// deliberately NOT the user-enumeration oracle the invite design forbids. That one is the OWNER's,
// and an owner never sees this token; see MembershipInviteService.preview.
//
// The same longer bound as accepting, for the same reason and one step earlier: this call gates the
// whole screen, so a cold-start abort here leaves a valid link showing nothing at all.
export function previewInvite({ inviteId, token }) {
  return apiClient.post('/api/auth/invite/preview', { inviteId, token }, { timeoutMs: AUTH_TIMEOUT_MS });
}

// Finishing an invitation MINTS a session, so it gets the same longer bound as login and
// confirm-email: there is nothing cached behind it, and an abort leaves someone stranded on a link
// they cannot retry from anywhere else.
//
// `password` means one of two things and is omitted for a third:
//   - SET_PASSWORD -- the address has no account, so this is the password being chosen.
//   - SIGN_IN      -- the address has one, so this is that password being PROVED, exactly as at
//                     /login. It used to be sent and silently ignored, which is what made an
//                     invite link a password-less way into an existing account.
//   - omitted      -- the invitee is already signed in as the invited address, and the session
//                     token this request carries anyway is the proof instead.
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
