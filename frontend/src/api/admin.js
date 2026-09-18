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

export function listContactMessages() {
  return apiClient.get('/api/admin/contact-messages');
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

// Both only exist as routes in local/lower -- see TestDataAdminController's own comment for why
// this is gated at the Spring bean level, not just hidden here.
export function previewTestData() {
  return apiClient.get('/api/admin/test-data/preview');
}

// A longer-than-default timeout, not the shared 15s: even after TestDataCleanupService's bulk-
// delete rewrite, this can still touch every e2e account lower has accumulated across repeated
// deploys' e2e runs in one request. The default 15s previously fired before the (then
// one-account-at-a-time) delete finished, and the client timing out never canceled the backend's
// still-running transaction -- the delete kept running to completion or failure with nobody able
// to see the outcome. 60s gives real headroom without masking a genuine hang forever.
export function deleteTestData() {
  return apiClient.delete('/api/admin/test-data', undefined, { timeoutMs: 60000 });
}

// The admin portal's only writes besides the alert-settings toggle and the e2e test-data purge:
// grant a household a paid plan outright, or take that grant back. See
// .claude/rules/admin-portal.md's third sanctioned exception.
//
// The body carries the tier, the band (Pro only) and the reason -- and deliberately nothing else.
// The household is the path segment, and the acting admin is whoever the bearer token says they
// are: the server reads it from the security context and would ignore an actorEmail here, because
// an audit trail a caller can write their own name into is not one.
export function grantComp(accountId, { plan, band, note }) {
  return apiClient.post(`/api/admin/accounts/${accountId}/comp`, { plan, band, note });
}

export function revokeComp(accountId) {
  return apiClient.delete(`/api/admin/accounts/${accountId}/comp`);
}
