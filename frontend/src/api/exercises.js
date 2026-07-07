import { apiClient } from './client';

export function listExercises() {
  return apiClient.get('/api/exercises');
}

export function addExercise({ name, categoryId, setupFieldNames }) {
  return apiClient.post('/api/exercises', { name, categoryId, setupFieldNames });
}

export function updateExercise(exerciseId, { name, categoryId, setupFieldNames }) {
  return apiClient.put(`/api/exercises/${exerciseId}`, { name, categoryId, setupFieldNames });
}

export function removeExercise(exerciseId) {
  return apiClient.delete(`/api/exercises/${exerciseId}`);
}
