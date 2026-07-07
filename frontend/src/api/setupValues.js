import { apiClient } from './client';

export function listSetupValues(personId, exerciseId) {
  return apiClient.get(`/api/people/${personId}/exercises/${exerciseId}/setup-values`);
}

export function setSetupValue(personId, exerciseId, fieldId, value) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/setup-fields/${fieldId}/value`, { value });
}
