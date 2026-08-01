import { apiClient } from './client';

export function getOverview() {
  return apiClient.get('/api/admin/overview');
}

export function listAccounts() {
  return apiClient.get('/api/admin/accounts');
}

export function listPeople() {
  return apiClient.get('/api/admin/people');
}

export function listPendingRegistrations() {
  return apiClient.get('/api/admin/pending-registrations');
}

export function listRegistrationEvents() {
  return apiClient.get('/api/admin/registration-events');
}

export function getRegistrationAlertSettings() {
  return apiClient.get('/api/admin/registration-alert-settings');
}

export function updateRegistrationAlertSettings(settings) {
  return apiClient.put('/api/admin/registration-alert-settings', settings);
}

export function getHealth() {
  return apiClient.get('/api/admin/health');
}
