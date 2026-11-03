import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loginAs, registerHousehold, setBillingPlan } from './support/auth';

/**
 * Member logins are a Plus feature. Dropping to Free PAUSES them; going back to Plus resumes them.
 *
 * ⚠️ Every assertion here is really about the same distinction: a PAUSE, not a punishment. Nothing
 * is deleted, no membership is revoked, and no queued write is discarded. If any of that stops
 * being true, the copy on the paused screen becomes a lie at the moment somebody reads it.
 */

async function latestInvite(request: APIRequestContext, ownerEmail: string) {
  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const response = await request.get(`${apiUrl}/api/auth/test/pending-invite`, {
    params: { ownerEmail },
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ inviteId: number; token: string }>;
}

async function openProfile(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
}

async function logout(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * Reloads until `shows` is on screen -- for the first screen after a PLAN CHANGE, and only there.
 *
 * A plan change reaches every backend replica within ~2s, not instantly: the replica that made it
 * evicts its access cache at once, and every other one picks it up from the invalidation log on its
 * next poll (AccessInvalidationPoller, every 2s). So a reload straight after setBillingPlan can be
 * answered by a replica still holding the old status. The app asks /me once per load, so that one
 * answer stands until the next reload -- for a person too, which is the accepted ~2s cost of the
 * design (docs/architecture/scaling.md). On lower's two-replica test window (2026-11-02) this spec
 * failed in both engines on exactly that: the plan went back to Plus, the reload landed on the other
 * replica, and the paused screen came back.
 *
 * Asserting on the first answer tests which replica the load balancer picked. Reloading until the
 * new state shows tests what the spec is about: that it arrives, with nothing re-invited or lost.
 * Each attempt waits a few seconds before reloading again, so a slow but correct first load is not
 * reloaded away mid-render.
 */
async function reloadUntil(page: Page, shows: Locator) {
  await expect(async () => {
    await page.reload();
    await expect(shows).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 20000 });
}

/** A Plus household with a working member login. Leaves the page signed in AS THE MEMBER. */
async function plusHouseholdWithAMember(page: Page, request: APIRequestContext) {
  const ownerEmail = await registerHousehold(page, request, 'Nate');
  await setBillingPlan(request, ownerEmail, 'PLUS');
  await page.reload();

  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sam', exact: true }).first()).toBeVisible();

  const memberEmail = `huddle+e2e-member-${randomUUID().slice(0, 8)}@starner.co`;
  await openProfile(page);
  await page.getByRole('button', { name: 'Enable login' }).click();
  await page.getByPlaceholder('them@example.com').fill(memberEmail);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('INVITED')).toBeVisible();

  const { inviteId, token } = await latestInvite(request, ownerEmail);
  await logout(page);
  await page.goto(`/join?i=${inviteId}&t=${encodeURIComponent(token)}`);
  await page.getByPlaceholder('At least 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Join household' }).click();
  await expect(page).toHaveURL(/\/app\/log/);

  return { ownerEmail, memberEmail };
}

test.describe('A member login when the household leaves Plus', () => {
  /**
   * ⚠️ The whole app is replaced, and the reassurance is the point. The honest fear on being told
   * your login stopped working is that a lapsed payment cost you your training history.
   */
  test('the member gets one screen that says why, and says nothing was deleted', async ({ page, request }) => {
    const { ownerEmail } = await plusHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await reloadUntil(page, page.getByText(/Your login is paused/i));

    await expect(page.getByText(/Nothing has been deleted/i)).toBeVisible();
    await expect(page.getByText(/Nate can turn it back on/)).toBeVisible();

    // ⚠️ IT NAMES NO TIER, and that is precision rather than vagueness. This asserted
    // "turn Plus back on" until the tier that lapsed stopped being knowable from here: by the time
    // this screen renders, the account IS Free again. On a trainer's account the lapsed tier was
    // PRO, and telling a client their trainer can "turn Plus back on" names a plan nobody ever
    // bought. "Huddle's paid plans" is the only sentence true on every tier, Team included.
    await expect(page.getByText(/paid plans/)).toBeVisible();
    await expect(page.getByText(/Huddle Plus/)).toHaveCount(0);

    // No app behind it -- there is nothing here they could use, and every control would 403.
    await expect(page.getByRole('link', { name: 'Log' })).toHaveCount(0);
    // And no upgrade button: managing the plan is owner-only, so one could only ever fail.
    await expect(page.getByRole('button', { name: /upgrade|manage billing/i })).toHaveCount(0);
  });

  /**
   * ⚠️ THE RECOVERY, and the reason this is a pause rather than a revocation. No re-invitation, no
   * re-created person, nothing to restore -- the same login simply starts working again.
   */
  test('going back to Plus resumes the same login, with no re-invitation', async ({ page, request }) => {
    const { ownerEmail } = await plusHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await reloadUntil(page, page.getByText(/Your login is paused/i));

    await setBillingPlan(request, ownerEmail, 'PLUS');
    // Straight back into the app, on their own person. The person pill is the positive signal: the
    // "not paused" check below used to run first, and passed on a page that had not drawn anything
    // yet -- which is how a paused screen arriving a beat later slipped past it.
    const ownPerson = page.locator('.app-chrome').getByRole('button', { name: 'Sam', exact: true });
    await reloadUntil(page, ownPerson);
    await expect(ownPerson).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByText(/Your login is paused/i)).toHaveCount(0);
  });

  /**
   * ⚠️ The owner is never paused, and it is not a courtesy: they are the only person who can put
   * the household back on Plus. Pausing them would lock everyone out of the screen that undoes it.
   */
  test('the owner keeps full access, and still sees the member and their data', async ({ page, request }) => {
    const { ownerEmail } = await plusHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await logout(page);
    await loginAs(page, ownerEmail, 'password123');

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText(/Your login is paused/i)).toHaveCount(0);

    // Sam is still here, and still shows as holding a login -- nothing was revoked.
    //
    // ⚠️ Scoped to the Logins list, not a bare page-wide getByText: PersonPillBar renders every
    // person's name as its own button once a household has 2+ people (frontend-core.md's sticky
    // chrome), so an unscoped getByText('Sam') is ambiguous the instant both it and this list's
    // own "Sam" row have mounted -- ambiguous on every run, not intermittently, but only reliably
    // hit locally once LoginsSection's separate listLogins() fetch resolves. Locally that lands
    // late enough that this assertion often already succeeded against the pill alone; lower's
    // slower round trip closes that window, making the strict-mode violation the norm there
    // instead of the exception. The sibling "resumes the same login" test above already had to
    // solve the identical ambiguity by scoping to `.app-chrome`.
    await openProfile(page);
    const loginsList = page.getByTestId('logins-list');
    await expect(loginsList.getByText('Sam', { exact: true })).toBeVisible();
    await expect(loginsList.getByText('HAS LOGIN')).toHaveCount(2);
  });

  /**
   * The owner's warning, on the last screen of ours before Stripe's portal. If it is not here it
   * is nowhere, and an owner finds out from the people whose logins stopped working.
   */
  test('the owner is told, by name, whose logins a downgrade would pause', async ({ page, request }) => {
    const { ownerEmail } = await plusHouseholdWithAMember(page, request);

    await logout(page);
    await loginAs(page, ownerEmail, 'password123');
    await page.goto('/app/billing');

    await expect(page.getByText(/1 personal login will stop working/)).toBeVisible();
    await expect(page.getByText(/Sam/).first()).toBeVisible();
    await expect(page.getByText(/Nothing is deleted/)).toBeVisible();
  });
});
