import { apiClient } from './client';

export function updateDefaultUnit(defaultUnit) {
  return apiClient.put('/api/account/default-unit', { defaultUnit });
}

// Whether members of this account see everyone in it, or only themselves.
//
// Tier-3 gated, never the durable outbox: it is an account-wide privacy setting, and queueing it
// would mean a trainer toggling clients private offline, seeing it "take", and having every client
// visible to every other client until the device reconnects.
export function setMemberVisibility(membersSeeEveryone) {
  return apiClient.put('/api/account/member-visibility', { membersSeeEveryone });
}

// The muscle highlighter (the shaded body diagrams), on or off for the whole account. Owner only.
// Tier-3 gated like the default unit: it is a setting, not something logged mid-workout.
export function setMuscleMap(enabled) {
  return apiClient.put('/api/account/muscle-map', { enabled });
}

// `reconfirmation` is the Apple / Google proof ({ provider, idToken, nonce, appleAuthorizationCode?,
// appleRedirectUri? }) a login with no password sends instead of `password` -- and that a login with
// Apple connected must send (with Apple's code) so Huddle's Apple sign-in can be revoked first.
export function deleteAccount(confirmationText, password, reconfirmation) {
  return apiClient.delete('/api/account', { confirmationText, password, reconfirmation });
}
