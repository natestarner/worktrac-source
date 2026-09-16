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

export function deleteAccount(confirmationText, password) {
  return apiClient.delete('/api/account', { confirmationText, password });
}
