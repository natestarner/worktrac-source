import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, registerHousehold, setBillingPlan } from './support/auth';

/**
 * Member logins are a Pro feature. Dropping to Free PAUSES them; going back to Pro resumes them.
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

/** A Pro household with a working member login. Leaves the page signed in AS THE MEMBER. */
async function proHouseholdWithAMember(page: Page, request: APIRequestContext) {
  const ownerEmail = await registerHousehold(page, request, 'Nate');
  await setBillingPlan(request, ownerEmail, 'PRO');
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

test.describe('A member login when the household leaves Pro', () => {
  /**
   * ⚠️ The whole app is replaced, and the reassurance is the point. The honest fear on being told
   * your login stopped working is that a lapsed payment cost you your training history.
   */
  test('the member gets one screen that says why, and says nothing was deleted', async ({ page, request }) => {
    const { ownerEmail } = await proHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await page.reload();

    await expect(page.getByText(/Your login is paused/i)).toBeVisible();
    await expect(page.getByText(/Nothing has been deleted/i)).toBeVisible();
    await expect(page.getByText(/Nate can turn Pro back on/)).toBeVisible();

    // No app behind it -- there is nothing here they could use, and every control would 403.
    await expect(page.getByRole('link', { name: 'Log' })).toHaveCount(0);
    // And no upgrade button: managing the plan is owner-only, so one could only ever fail.
    await expect(page.getByRole('button', { name: /upgrade|manage billing/i })).toHaveCount(0);
  });

  /**
   * ⚠️ THE RECOVERY, and the reason this is a pause rather than a revocation. No re-invitation, no
   * re-created person, nothing to restore -- the same login simply starts working again.
   */
  test('going back to Pro resumes the same login, with no re-invitation', async ({ page, request }) => {
    const { ownerEmail } = await proHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await page.reload();
    await expect(page.getByText(/Your login is paused/i)).toBeVisible();

    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    // Straight back into the app, on their own person.
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByText(/Your login is paused/i)).toHaveCount(0);
    await expect(page.locator('.app-chrome').getByRole('button', { name: 'Sam', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * ⚠️ The owner is never paused, and it is not a courtesy: they are the only person who can put
   * the household back on Pro. Pausing them would lock everyone out of the screen that undoes it.
   */
  test('the owner keeps full access, and still sees the member and their data', async ({ page, request }) => {
    const { ownerEmail } = await proHouseholdWithAMember(page, request);

    await setBillingPlan(request, ownerEmail, 'FREE');
    await logout(page);
    await loginAs(page, ownerEmail, 'password123');

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText(/Your login is paused/i)).toHaveCount(0);

    // Sam is still here, and still shows as holding a login -- nothing was revoked.
    await openProfile(page);
    await expect(page.getByText('Sam')).toBeVisible();
    await expect(page.getByText('HAS LOGIN')).toHaveCount(2);
  });

  /**
   * The owner's warning, on the last screen of ours before Stripe's portal. If it is not here it
   * is nowhere, and an owner finds out from the people whose logins stopped working.
   */
  test('the owner is told, by name, whose logins a downgrade would pause', async ({ page, request }) => {
    const { ownerEmail } = await proHouseholdWithAMember(page, request);

    await logout(page);
    await loginAs(page, ownerEmail, 'password123');
    await page.goto('/app/billing');

    await expect(page.getByText(/1 personal login will stop working/)).toBeVisible();
    await expect(page.getByText(/Sam/).first()).toBeVisible();
    await expect(page.getByText(/Nothing is deleted/)).toBeVisible();
  });
});
