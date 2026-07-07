import { apiClient } from './client';

export function logLiveSet(personId, { exerciseId, weight, reps }) {
  return apiClient.post(`/api/people/${personId}/live-sets`, { exerciseId, weight, reps });
}

export function logSetIntoSession(sessionId, { exerciseId, weight, reps }) {
  return apiClient.post(`/api/sessions/${sessionId}/sets`, { exerciseId, weight, reps });
}

export function editSet(setId, { weight, reps }) {
  return apiClient.patch(`/api/sets/${setId}`, { weight, reps });
}

export function deleteSet(setId) {
  return apiClient.delete(`/api/sets/${setId}`);
}

export function listSessionSets(sessionId, exerciseId) {
  return apiClient.get(`/api/sessions/${sessionId}/sets?exerciseId=${exerciseId}`);
}
