import { apiClient } from './client';

export function getExerciseSummary(personId, exerciseId, excludeSessionId) {
  const query = excludeSessionId ? `?excludeSessionId=${excludeSessionId}` : '';
  return apiClient.get(`/api/people/${personId}/exercises/${exerciseId}/summary${query}`);
}

// GET /prs and the three Trends endpoints are no longer called: the PRs board and Trends are derived
// on the device from History (hooks/useStatsFromHistory.js). The server keeps answering them for
// installed apps from before that change.
