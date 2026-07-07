import { apiClient } from './client';

export function register({ accountName, email, password, personName }) {
  return apiClient.post('/api/auth/register', { accountName, email, password, personName });
}

export function login({ email, password }) {
  return apiClient.post('/api/auth/login', { email, password });
}

export function me() {
  return apiClient.get('/api/auth/me');
}
