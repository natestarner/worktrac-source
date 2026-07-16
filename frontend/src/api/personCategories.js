import { apiClient } from './client';

// Per-person, user-created categories for organising the Log picker (see the exercises
// rethink -- the catalog no longer ships a shared taxonomy).

export function listPersonCategories(personId) {
  return apiClient.get(`/api/people/${personId}/categories`);
}

// Seeded common category names offered as one-tap starters, minus ones already created.
export function listCategoryRecommendations(personId) {
  return apiClient.get(`/api/people/${personId}/categories/recommendations`);
}

export function createPersonCategory(personId, name) {
  return apiClient.post(`/api/people/${personId}/categories`, { name });
}

export function renamePersonCategory(personId, categoryId, name) {
  return apiClient.put(`/api/people/${personId}/categories/${categoryId}`, { name });
}

export function deletePersonCategory(personId, categoryId) {
  return apiClient.delete(`/api/people/${personId}/categories/${categoryId}`);
}
