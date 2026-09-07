import { APIRequestContext, Page, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// randomUUID, not Math.random(): these addresses are typed into a real login form, so CodeQL traces
// the value into a credential context and reports js/insecure-randomness as HIGH severity -- which
// it did, three times, on the phase 6 PR. Nothing here is a secret (the password is a shared
// literal and the suffix only has to be unique), but a scanner that must be argued with on every
// auth PR is worse than a one-line change that removes the question. Collision resistance across a
// suite that registers hundreds of households per run is a free bonus.
//
// ⚠️ The `huddle+e2e-` PREFIX and the `@starner.co` domain are the halves that must NOT change --
// TestDataCleanupService matches on them from an independently-maintained copy of the literal.
// Only the unique suffix moved.
function uniqueSuffix() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}


// Registration now requires confirming a 6-digit emailed code before the account exists --
// this can't read a real inbox, so it drives the same test-support endpoint the backend
// exposes only in local/lower (TestSupportController), gated by a shared-secret header
// (E2E_TEST_SUPPORT_KEY) on top of the profile restriction. The backend's API URL is
// discovered the same way the app itself does at runtime -- fetching /config.json from the
// frontend's own origin -- rather than hardcoding or requiring a second env var here.
//
// Centralized here instead of duplicated per spec file: seven spec files previously each
// carried their own near-identical copy of this register-and-assert-redirect snippet.
//
// Recipient is a plus-addressed sub-address of a real mailbox (huddle@starner.co) the team
// controls specifically to receive e2e traffic, filed into its own folder by a mail rule on
// the "huddle+e2e-" prefix -- switched 2026-08-02 from e2e-<...>@example.com, which bounced
// every send (example.com can never resolve to a real mailbox) and counted against the sending
// domain's ACS reputation on every single e2e run. This "huddle+e2e-" prefix also matches
// EmailProperties.e2eNoopRecipientPattern, so EmailService skips the real ACS send for it
// entirely (see live-email-canary.spec.ts for the one deliberate exception, which passes its
// own emailOverride here specifically so it does NOT match that prefix). See
// TestDataCleanupService's CURRENT_EMAIL_PATTERN for the backend side of the cleanup pattern --
// broader than just this prefix (also covers live-email-canary's address), but the two must
// still stay in sync with whatever this function actually generates.
//
// emailOverride lets a caller supply its own address instead of the default e2e-noop'd pattern
// -- used only by live-email-canary.spec.ts, which needs an address that deliberately does NOT
// match the no-op pattern so it triggers a real send.
//
// keepWelcome skips the unconditional dismissal below -- used only by
// onboarding-tour.spec.ts, which needs the welcome modal still on screen to test it. Every other
// spec goes through this function not caring that the modal ever existed, which is the point.
export interface RegisterHouseholdOptions {
  emailOverride?: string;
  keepWelcome?: boolean;
}

export async function registerHousehold(
  page: Page,
  request: APIRequestContext,
  personName: string,
  options: RegisterHouseholdOptions = {},
): Promise<string> {
  const { emailOverride, keepWelcome = false } = options;
  const email = emailOverride ?? `huddle+e2e-${Date.now()}-${uniqueSuffix()}@starner.co`;

  await page.goto('/register');
  await page.getByPlaceholder('e.g. Alex').fill(personName);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page).toHaveURL(/\/confirm-email/);

  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const code = await fetchPendingCode(request, apiUrl, email);

  await page.getByPlaceholder('123456').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/app\/log/);

  // Every fresh registration arms the first-run welcome modal, so it lands in front of every one
  // of this helper's ~149 call sites. Dismissed UNCONDITIONALLY, never behind an
  // `if (await modal.isVisible())` -- isVisible() has NO auto-waiting, and "right now" is the
  // instant the URL assertion above passed, which is before the modal has necessarily mounted
  // (ProtectedRoute gates on rehydrate, AppShell returns null until activePersonId resolves, and
  // the flag itself is read in an effect). That is a coin flip baked into every spec that runs
  // through this helper, and losing it leaves the modal to eat the spec's NEXT click and fail
  // elsewhere with "intercepts pointer events" -- the exact signature frontend-core.md records
  // twice already. click() carries Playwright's own actionability wait, so the unconditional
  // version is the deterministic one, and it encodes the invariant rather than merely working
  // around it.
  if (!keepWelcome) {
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeHidden();
  }

  return email;
}

// Puts a household on Pro (or back on Free) without Stripe existing at all -- the same escape
// hatch e2eNoopRecipientPattern provides for real email sends, and the reason this suite needs no
// Stripe credentials in any environment.
//
// The backend writes `comped`, so a household set Pro here is entitled through the SAME single
// derivation a paying one uses (SubscriptionService.isPro). A spec that passes against this is
// exercising the real entitlement path rather than a fixture built for tests.
export async function setBillingPlan(
  request: APIRequestContext,
  email: string,
  plan: 'FREE' | 'PRO',
): Promise<void> {
  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const response = await request.post(
    `${apiUrl}/api/auth/test/billing-plan?email=${encodeURIComponent(email)}&plan=${plan}`,
    { headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' } },
  );
  // 404 is what this endpoint returns for a wrong/missing key as well as an unknown email, so a
  // misconfigured E2E_TEST_SUPPORT_KEY surfaces here rather than as a confusing assertion failure
  // three lines later in whatever spec called this.
  expect(response.status(), `setBillingPlan failed -- check E2E_TEST_SUPPORT_KEY`).toBe(204);
}

// Gives an existing person in an existing household their own MEMBER login, and signs in as them.
//
// ⚠️ The email MUST come from the same generator registerHousehold uses. TestDataCleanupService
// reaps e2e users by the `huddle+%@starner.co` pattern, and that pattern is an independently
// maintained copy of the literal this file produces -- an address outside it leaves a real user
// row in lower forever, surfacing much later as an unrelated FK failure during some other
// cleanup. A member's user row in particular OUTLIVES the household it was invited to.
//
// Drives the same profile-gated, shared-secret test-support route as setBillingPlan, because the
// invite flow does not exist yet (phase 7 builds it). What it creates is a REAL user and a REAL
// membership, so a spec using this exercises the same AccountAccessService resolution and the same
// guards a genuine member will hit.
// memberEmailOverride attaches an EXISTING credential to this household instead of minting a new
// one -- the shape that makes one login belong to two households, which is what phase 6 is about.
// The backend reuses a matching user row rather than creating a second, and leaves its password
// alone, so the caller must pass an address whose password is already the shared 'password123'.
export async function addMemberLogin(
  page: Page,
  request: APIRequestContext,
  ownerEmail: string,
  personName: string,
  memberEmailOverride?: string,
): Promise<{ email: string; password: string }> {
  const email = memberEmailOverride
    ?? `huddle+e2e-member-${Date.now()}-${uniqueSuffix()}@starner.co`;
  const password = 'password123';

  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const params = new URLSearchParams({ ownerEmail, personName, memberEmail: email, password });
  const response = await request.post(`${apiUrl}/api/auth/test/member?${params.toString()}`, {
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  // 404 covers a wrong key, an unknown owner AND an unknown person name, so a typo in any of the
  // three surfaces here rather than as a confusing assertion three lines into the spec.
  expect(
    response.status(),
    `addMemberLogin failed for owner=${ownerEmail} person=${personName}. `
      + '404 covers a wrong E2E_TEST_SUPPORT_KEY, an unknown owner AND an unknown person name, '
      + 'so check all three; '
      + "409 means that person already has a login -- naming the OWNER's own person does this. "
      + `Body: ${await response.text()}`,
  ).toBe(204);

  return { email, password };
}

// Flips accounts.members_see_everyone for one household. The product ships this forced ON with no
// endpoint and no UI (see V66), so this profile-gated route is the ONLY way to exercise the OFF
// path -- which is what keeps the Team-tier seam tested code rather than dead code.
export async function setMemberVisibility(
  request: APIRequestContext,
  ownerEmail: string,
  membersSeeEveryone: boolean,
): Promise<void> {
  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const params = new URLSearchParams({ ownerEmail, membersSeeEveryone: String(membersSeeEveryone) });
  const response = await request.post(`${apiUrl}/api/auth/test/member-visibility?${params.toString()}`, {
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  expect(response.status(), 'setMemberVisibility failed -- check E2E_TEST_SUPPORT_KEY').toBe(204);
}

// Signs in through the real login form, so a spec exercises the same path a member actually uses.
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  // LoginPage's placeholders are "Email"/"Password"; RegisterPage's are the you@example.com /
  // "At least 8 characters" pair registerHousehold uses. They are different screens.
  await page.getByPlaceholder('Email', { exact: true }).fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/log/);
}

// TestCodeCache (see TestCodeCache.java) is a plain in-memory map inside the running
// container -- register() only returns after writing to it, so a lookup immediately after
// should always find it. It's occasionally missing anyway: the lower backend scales to zero
// when idle (min-replicas 0), and Azure Container Apps can briefly route two requests to two
// different instances during a scale event, leaving the code written on an instance this GET
// doesn't land on. Retrying tolerates that transient case (confirmed live 2026-07-13 as the
// cause of an intermittent "Unexpected end of JSON input" failure) without masking a real
// bug -- if the code is genuinely never sent, this still fails after the deadline.
export async function fetchPendingCode(request: APIRequestContext, apiUrl: string, email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const response = await request.get(`${apiUrl}/api/auth/test/pending-code`, {
      params: { email },
      headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
    });
    if (response.ok()) {
      const { code } = await response.json();
      return code;
    }
    if (Date.now() >= deadline) {
      throw new Error(`No pending code appeared for ${email} within 10s (last status: ${response.status()})`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export type EmailOutcome = { status: 'SENT' | 'FAILED'; messageId: string | null; detail: string | null };

// Backs live-email-canary.spec.ts -- polls the registration_events audit trail (via
// TestSupportController's /api/auth/test/email-outcome) for the real outcome of a verification
// email send, since a successful register+confirm alone can't distinguish a real send from a
// no-op'd or failed one (the code is written to TestCodeCache synchronously, independent of the
// async email dispatch). A longer deadline than fetchPendingCode's: this is waiting on a real
// external network round trip to Azure Communication Services, not just an in-memory cache write.
// 30s, not 20s: confirmed too tight against real lower conditions (a 404-then-retry-succeeds
// flake against the deployed lower environment, most likely lower's Container App scaling from
// zero on a cold run) -- the same "real external call needs a re-tuned timeout" lesson the SDLC
// guide's registration section already documents.
export async function fetchEmailOutcome(request: APIRequestContext, apiUrl: string, email: string): Promise<EmailOutcome> {
  const deadline = Date.now() + 30_000;
  while (true) {
    const response = await request.get(`${apiUrl}/api/auth/test/email-outcome`, {
      params: { email },
      headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
    });
    if (response.ok()) {
      return await response.json();
    }
    if (Date.now() >= deadline) {
      throw new Error(`No email outcome recorded for ${email} within 20s (last status: ${response.status()})`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
