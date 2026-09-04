import { apiClient } from './client';

export function listRoutines(personId) {
  return apiClient.get(`/api/people/${personId}/routines`);
}

export function createRoutine(personId, { name, exerciseIds }) {
  return apiClient.post(`/api/people/${personId}/routines`, { name, exerciseIds });
}

export function updateRoutine(personId, routineId, { name, exerciseIds }) {
  return apiClient.put(`/api/people/${personId}/routines/${routineId}`, { name, exerciseIds });
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
