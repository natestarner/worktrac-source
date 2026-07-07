import { apiClient } from './client';

export function getExerciseSummary(personId, exerciseId, excludeSessionId) {
  const query = excludeSessionId ? `?excludeSessionId=${excludeSessionId}` : '';
  return apiClient.get(`/api/people/${personId}/exercises/${exerciseId}/summary${query}`);
}

export function getPrs(personId) {
  return apiClient.get(`/api/people/${personId}/prs`);
}
