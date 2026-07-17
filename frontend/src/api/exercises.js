import { apiClient } from './client';

// The full catalog, used for search. categoryId is optional now that categories are per-person.
export function listExercises() {
  return apiClient.get('/api/exercises');
}

export function addExercise({ name, categoryId }) {
  return apiClient.post('/api/exercises', { name, categoryId });
}

export function updateExercise(exerciseId, { name, categoryId }) {
  return apiClient.put(`/api/exercises/${exerciseId}`, { name, categoryId });
}

export function removeExercise(exerciseId) {
  return apiClient.delete(`/api/exercises/${exerciseId}`);
}

// --- Per-person view: the Log picker list (favorites UNION logged), favoriting, category
// filing, and the custom setup-field overlay ---

export function listPersonExercises(personId) {
  return apiClient.get(`/api/people/${personId}/exercises`);
}

export function favoriteExercise(personId, exerciseId) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/favorite`);
}

export function unfavoriteExercise(personId, exerciseId) {
  return apiClient.delete(`/api/people/${personId}/exercises/${exerciseId}/favorite`);
}

export function setExerciseCategory(personId, exerciseId, personCategoryId) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/category`, { personCategoryId });
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
