import { apiClient } from './client';

export function updateDefaultUnit(defaultUnit) {
  return apiClient.put('/api/account/default-unit', { defaultUnit });
}

export function deleteAccount(confirmationText, password) {
  return apiClient.delete('/api/account', { confirmationText, password });
}
