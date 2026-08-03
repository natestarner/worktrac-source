import { request as playwrightRequest, APIRequestContext, FullConfig } from '@playwright/test';
import { fetchPendingCode } from './auth';

// Wipes every trace of e2e test data after a LOCAL run, via the existing admin "Delete all
// e2e test data" endpoint (DELETE /api/admin/test-data -- see CLAUDE.md's Admin Portal Notes
// / TestDataCleanupService), so repeated local runs don't accumulate huddle+e2e-... accounts
// indefinitely. Deployed environments (lower) still rely on a manual admin-portal click --
// see the localhost guard below for why this deliberately never runs there.
//
// Never throws: cleanup is a hygiene nicety, not a correctness gate for the actual e2e run,
// so any failure here is logged and swallowed rather than failing the whole suite.
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS?.split(',')[0]?.trim()) || 'nate+huddleadmin@starner.co';
const ADMIN_PASSWORD = 'password123';

export default async function globalTeardown(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
  if (!baseURL || !baseURL.includes('localhost')) {
    // Deliberately inert against a deployed target (lower/production): ADMIN_EMAIL is a real
    // address on the team's real domain, not an e2e-noop'd one, so registering/logging in as
    // it against a real environment would be a genuine, unwanted side effect rather than a
    // harmless local convenience.
    return;
  }

  let api: APIRequestContext | undefined;
  try {
    const configResponse = await fetch(`${baseURL}/config.json`);
    const { apiUrl } = (await configResponse.json()) as { apiUrl: string };
    // Local dev serves an empty apiUrl (same-origin, Vite proxies /api/* to the backend) --
    // only a deployed target's config.json carries a real absolute apiUrl. Fall back to the
    // frontend's own origin so this works the same way the app itself resolves API calls.
    api = await playwrightRequest.newContext({ baseURL: apiUrl || baseURL });

    const token = (await login(api)) ?? (await registerAdmin(api, apiUrl));
    if (!token) {
      console.warn('[globalTeardown] Could not obtain an admin session; skipping e2e test-data cleanup.');
      return;
    }

    const del = await api.delete('/api/admin/test-data', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.ok()) {
      console.log('[globalTeardown] Cleaned up e2e test data:', await del.json());
    } else {
      console.warn(`[globalTeardown] test-data cleanup returned ${del.status()}`);
    }
  } catch (err) {
    console.warn('[globalTeardown] e2e test-data cleanup failed (non-fatal):', err);
  } finally {
    await api?.dispose();
  }
}

async function login(api: APIRequestContext): Promise<string | null> {
  const res = await api.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.token;
}

async function registerAdmin(api: APIRequestContext, apiUrl: string): Promise<string | null> {
  const res = await api.post('/api/auth/register', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, personName: 'Admin' },
  });
  if (!res.ok()) return null;

  const code = await fetchPendingCode(api, apiUrl, ADMIN_EMAIL);
  const confirm = await api.post('/api/auth/confirm-email', { data: { email: ADMIN_EMAIL, code } });
  if (!confirm.ok()) return null;

  // confirm-email's auto-login doesn't reconcile the ADMIN role (see CLAUDE.md) -- an
  // explicit login does, which is why this always logs in again rather than reusing
  // confirm-email's own returned token.
  return login(api);
}
