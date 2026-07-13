import { apiClient } from './client';

export function listPeople() {
  return apiClient.get('/api/people');
}

export function addPerson(name) {
  return apiClient.post('/api/people', { name });
}

export function updatePerson(personId, name) {
  return apiClient.patch(`/api/people/${personId}`, { name });
}

export function removePerson(personId) {
  return apiClient.delete(`/api/people/${personId}`);
}
