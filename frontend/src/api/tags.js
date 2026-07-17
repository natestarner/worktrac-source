import { apiClient } from './client';

// The account's shared, free-text tag vocabulary. Tags are account-level (not per-person) and
// applied to exercises per-person -- see setExerciseTags in exercises.js for the many-to-many
// link.

export function listTags() {
  return apiClient.get('/api/tags');
}

export function createTag(name) {
  return apiClient.post('/api/tags', { name });
}

export function renameTag(tagId, name) {
  return apiClient.put(`/api/tags/${tagId}`, { name });
}

export function deleteTag(tagId) {
  return apiClient.delete(`/api/tags/${tagId}`);
}
