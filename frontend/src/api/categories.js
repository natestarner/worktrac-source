import { apiClient } from './client';

export function listCategories() {
  return apiClient.get('/api/categories');
}

export function addCategory(name) {
  return apiClient.post('/api/categories', { name });
}

export function removeCategory(categoryId) {
  return apiClient.delete(`/api/categories/${categoryId}`);
}
