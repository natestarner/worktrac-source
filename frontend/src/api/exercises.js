import { apiClient } from './client';

// The full catalog, used for search. Exercises carry no taxonomy of their own -- organization is
// via per-person tags (see setExerciseTags below).
export function listExercises() {
  return apiClient.get('/api/exercises');
}

export function addExercise({ name }) {
  return apiClient.post('/api/exercises', { name });
}

export function updateExercise(exerciseId, { name }) {
  return apiClient.put(`/api/exercises/${exerciseId}`, { name });
}

export function removeExercise(exerciseId) {
  return apiClient.delete(`/api/exercises/${exerciseId}`);
}

// --- Per-person view: the Log picker list (favorites UNION logged), favoriting, tag
// application, and the custom setup-field overlay ---

export function listPersonExercises(personId) {
  return apiClient.get(`/api/people/${personId}/exercises`);
}

export function favoriteExercise(personId, exerciseId) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/favorite`);
}

export function unfavoriteExercise(personId, exerciseId) {
  return apiClient.delete(`/api/people/${personId}/exercises/${exerciseId}/favorite`);
}

export function setExerciseTags(personId, exerciseId, tagNames) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/tags`, { tags: tagNames });
}

export function listCustomFields(personId, exerciseId) {
  return apiClient.get(`/api/people/${personId}/exercises/${exerciseId}/custom-fields`);
}

export function addCustomField(personId, exerciseId, name) {
  return apiClient.post(`/api/people/${personId}/exercises/${exerciseId}/custom-fields`, { name });
}

export function updateCustomField(personId, exerciseId, fieldId, { name, value }) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/custom-fields/${fieldId}`, { name, value });
}

export function removeCustomField(personId, exerciseId, fieldId) {
  return apiClient.delete(`/api/people/${personId}/exercises/${exerciseId}/custom-fields/${fieldId}`);
}
