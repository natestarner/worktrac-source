import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOverview,
  getHealth,
  listAccounts,
  listPendingRegistrations,
  listPeople,
  listRegistrationEvents,
  getRegistrationAlertSettings,
  updateRegistrationAlertSettings,
} from './admin';
import { setAuthToken } from './client';

function jsonResponse(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('admin api', () => {
  beforeEach(() => {
    setAuthToken('a-token');
    global.fetch = vi.fn().mockReturnValue(jsonResponse({}));
  });

  it('getOverview hits GET /api/admin/overview with the bearer token', async () => {
    await getOverview();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/overview');
    expect(options.headers['Authorization']).toBe('Bearer a-token');
  });

  it('listAccounts hits GET /api/admin/accounts', async () => {
    await listAccounts();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/accounts');
  });

  it('listPeople hits GET /api/admin/people', async () => {
    await listPeople();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/people');
  });

  it('listPendingRegistrations hits GET /api/admin/pending-registrations', async () => {
    await listPendingRegistrations();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/pending-registrations');
  });

  it('getHealth hits GET /api/admin/health', async () => {
    await getHealth();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/health');
  });

  it('listRegistrationEvents hits GET /api/admin/registration-events', async () => {
    await listRegistrationEvents();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/registration-events');
  });

  it('getRegistrationAlertSettings hits GET /api/admin/registration-alert-settings', async () => {
    await getRegistrationAlertSettings();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/registration-alert-settings');
  });

  it('updateRegistrationAlertSettings hits PUT /api/admin/registration-alert-settings with the body', async () => {
    const settings = { alertOnRegistrationConfirmed: true, alertOnSendFailure: false, alertOnDeliveryFailure: true };
    await updateRegistrationAlertSettings(settings);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/registration-alert-settings');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual(settings);
  });
});
