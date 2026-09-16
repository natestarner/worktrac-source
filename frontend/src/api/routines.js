import { apiClient } from './client';

export function listRoutines(personId) {
  return apiClient.get(`/api/people/${personId}/routines`);
}

// ⚠️ `exercises` is the WHOLE TRUTH about the routine, targets included. The server rebuilds the
// routine from it, so an exercise sent without its target loses that target -- omitting one means
// "no target", never "leave what was there". Anything that edits a routine must round-trip what it
// read, not just the ids.
//
// Each entry: { exerciseId, targetWeight?, targetReps?, targetUnit? }.
export function createRoutine(personId, { name, exercises }) {
  return apiClient.post(`/api/people/${personId}/routines`, { name, exercises });
}

export function updateRoutine(personId, routineId, { name, exercises }) {
  return apiClient.put(`/api/people/${personId}/routines/${routineId}`, { name, exercises });
}

export function removeRoutine(personId, routineId) {
  return apiClient.delete(`/api/people/${personId}/routines/${routineId}`);
}

// routineIds must name every one of this person's routines, in the order they want them --
// the backend refuses a partial list rather than renumbering around the gaps.
export function reorderRoutines(personId, routineIds) {
  return apiClient.put(`/api/people/${personId}/routines/order`, { routineIds });
}

export function copyRoutine(personId, routineId, targetPersonIds) {
  return apiClient.post(`/api/people/${personId}/routines/${routineId}/copy`, { targetPersonIds });
}
