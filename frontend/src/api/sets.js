import { apiClient } from './client';

// idempotencyKey lets a retried/replayed write be deduped server-side (no double-insert);
// clientLoggedAt records when the set actually happened so a delayed/queued sync keeps an honest
// created_at (and, per the rest_seconds invariants, a non-real-time replay records null rest).
//
// durationSeconds carries a hold's seconds instead of a rep count (reps is then 0). Both endpoints
// take it -- rest_seconds still keys off WHICH endpoint handled the write, never off the measure.
export function logLiveSet(personId, { exerciseId, weight, reps, durationSeconds, idempotencyKey, clientLoggedAt }) {
  return apiClient.post(`/api/people/${personId}/live-sets`, {
    exerciseId,
    weight,
    reps,
    durationSeconds,
    idempotencyKey,
    clientLoggedAt,
  });
}

export function logSetIntoSession(sessionId, { exerciseId, weight, reps, durationSeconds, idempotencyKey, clientLoggedAt }) {
  return apiClient.post(`/api/sessions/${sessionId}/sets`, {
    exerciseId,
    weight,
    reps,
    durationSeconds,
    idempotencyKey,
    clientLoggedAt,
  });
}

export function editSet(setId, { weight, reps, durationSeconds }) {
  return apiClient.patch(`/api/sets/${setId}`, { weight, reps, durationSeconds });
}

export function deleteSet(setId) {
  return apiClient.delete(`/api/sets/${setId}`);
}

export function listSessionSets(sessionId, exerciseId) {
  return apiClient.get(`/api/sessions/${sessionId}/sets?exerciseId=${exerciseId}`);
}
