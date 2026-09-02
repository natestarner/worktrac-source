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

// How much of this person's history the Free-tier window is hiding right now:
// `{ windowStart, hiddenSessions, earliestHiddenAt }`. The SERVER answers this -- the client knows
// the plan but deliberately not the window, so there is never a second copy of the 90 days to drift
// from the clamp it describes. See HistoryWindowNotice.jsx.
export function getHistoryWindow(personId) {
  return apiClient.get(`/api/people/${personId}/history-window`);
}
