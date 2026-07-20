import { apiClient } from './client';

export function listPeople() {
  return apiClient.get('/api/people');
}

export function addPerson(name) {
  return apiClient.post('/api/people', { name });
}

export function updatePerson(personId, name) {
  return apiClient.patch(`/api/people/${personId}`, { name });
}

export function removePerson(personId) {
  return apiClient.delete(`/api/people/${personId}`);
}

// Household-wide setting, configured per person. Persisted account-side (not per-device) so it's
// consistent across devices and every person's toggle can be shown at once in Settings.
export function setRestTimerPreference(personId, enabled) {
  return apiClient.put(`/api/people/${personId}/rest-timer-preference`, { enabled });
}
