import { apiClient } from './client';

export function getLiveSession(personId) {
  return apiClient.get(`/api/people/${personId}/sessions/live`);
}

export function endWorkout(personId) {
  return apiClient.post(`/api/people/${personId}/sessions/live/end`);
}

export function createPastSession(personId, startedAt) {
  return apiClient.post(`/api/people/${personId}/sessions`, { startedAt });
}

export function editSession(sessionId, startedAt) {
  return apiClient.patch(`/api/sessions/${sessionId}`, { startedAt });
}

export function getHistory(personId) {
  return apiClient.get(`/api/people/${personId}/history`);
}
