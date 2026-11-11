import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Sign in with Apple / Google, driven end to end without Apple or Google -- whose bot checks keep
// them out of automation. The backend's TEST identity provider (TestIdentityTokens, local/lower
// only, behind the e2e key) mints real ID tokens; this installs the page hook the app's adapter
// calls (lib/native/socialSignIn.js), so the app shows a "Continue with Test provider" button and
// everything after the token -- our backend, the session, the screens -- is the production path.
//
// The hook gets the app's RAW nonce, and the token carries its hash, exactly as Apple and Google do.

export interface TestIdentity {
  subject: string;
  email: string | null;
  emailVerified?: boolean;
}

/** An identity in the e2e address space, so TestDataCleanupService reaps what it creates. */
export function newTestIdentity(): TestIdentity {
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  return { subject: `e2e-sub-${id}`, email: `huddle+e2e-sso-${Date.now()}-${id}@starner.co` };
}

/**
 * Installs the test provider for this page. `identity.current` decides who the NEXT sign-in is,
 * so a spec can switch identities between taps. Must run before the app loads (page.goto).
 */
export async function installTestIdentityProvider(
  page: Page,
  request: APIRequestContext,
  identity: { current: TestIdentity },
): Promise<void> {
  const { apiUrl } = await (await request.get('/config.json')).json();
  await page.exposeFunction('__huddleTestIdentityProvider', async ({ nonce }: { nonce: string }) => {
    const { subject, email, emailVerified = true } = identity.current;
    const response = await request.post(`${apiUrl}/api/auth/test/id-token`, {
      headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
      data: { subject, email, emailVerified, nonce },
    });
    expect(response.status(), 'minting a test ID token failed -- check E2E_TEST_SUPPORT_KEY').toBe(200);
    return { idToken: (await response.json()).idToken };
  });
}

/**
 * Whether this environment offers the test provider at all: the frontend's config.json must name
 * it (local dev's does), and the backend must have Apple/Google sign-in switched on.
 */
export async function testProviderConfigured(request: APIRequestContext): Promise<boolean> {
  const config = await (await request.get('/config.json')).json();
  return Boolean(config?.socialSignIn?.test);
}
