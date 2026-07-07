import { apiClient } from './client';

export function updateDefaultUnit(defaultUnit) {
  return apiClient.put('/api/account/default-unit', { defaultUnit });
}
