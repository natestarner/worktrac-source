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
  previewTestData,
  deleteTestData,
  grantComp,
  revokeComp,
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

  it('previewTestData hits GET /api/admin/test-data/preview', async () => {
    await previewTestData();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/test-data/preview');
  });

  it('deleteTestData hits DELETE /api/admin/test-data', async () => {
    await deleteTestData();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/test-data');
    expect(options.method).toBe('DELETE');
  });

  // Regression test for the delete-test-data timeout bug: the request used to abort at the
  it('grantComp posts the tier, band and note to the household path', async () => {
    await grantComp(42, { plan: 'PRO', band: 'STUDIO', note: 'coaching pilot' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/accounts/42/comp');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ plan: 'PRO', band: 'STUDIO', note: 'coaching pilot' });
  });

  // The acting admin is whoever the bearer token says they are. Sending an actor in the body would
  // let a caller write somebody else's name into the audit trail, so the client must not offer to
  // -- and the server ignores it besides (AdminAuthorizationTest pins that half).
  it('grantComp never sends an actor of its own', async () => {
    await grantComp(42, { plan: 'PLUS', band: null, note: null });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['band', 'note', 'plan']);
    expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer a-token');
  });

  it('revokeComp deletes the same household path', async () => {
    await revokeComp(42);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/accounts/42/comp');
    expect(options.method).toBe('DELETE');
  });

  // shared 15s default before the (then one-account-at-a-time) backend delete could finish.
  // Proves the wiring from admin.js through to client.js's per-call timeoutMs actually survives
  // a slow response well past that old 15s default.
  it('deleteTestData survives past the shared 15s default timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    let settled = false;
    deleteTestData()
      .catch(() => {})
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(20000);
    expect(settled).toBe(false);

    vi.useRealTimers();
  });
});
