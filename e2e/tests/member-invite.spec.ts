import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, registerHousehold } from './support/auth';

/**
 * The invite round trip, through the real UI: an owner enables a login, the invitee opens the link
 * and lands in the app as a member.
 *
 * <p>⚠️ The one thing this cannot do through the UI is read the emailed link — the raw token exists
 * only in the send, and the database holds a BCrypt hash. A profile-gated test-support route hands
 * the pending invite's id and a freshly-planted token back, which is the same trick
 * `fetchPendingCode` uses for registration codes. Everything either side of that is the real flow:
 * a real invite row, a real token check, a real membership.
 */
async function latestInvite(request: APIRequestContext, ownerEmail: string) {
  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const response = await request.get(`${apiUrl}/api/auth/test/pending-invite`, {
    params: { ownerEmail },
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  expect(
    response.status(),
    `pending-invite lookup failed for ${ownerEmail} -- 404 covers a wrong E2E_TEST_SUPPORT_KEY, `
      + 'an unknown owner AND no outstanding invite, so check all three.',
  ).toBe(200);
  return response.json() as Promise<{ inviteId: number; token: string }>;
}

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
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

test.describe('Enabling a member login', () => {
  test('an owner invites, the invitee joins, and lands as a member', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    const memberEmail = `huddle+e2e-member-${Date.now()}@starner.co`;

    await openProfile(page);

    // Sam has no login yet, so the owner is offered one.
    await expect(page.getByText('Logins', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable login' }).click();

    // The disclosure is on screen BEFORE the address field -- this is where somebody decides to
    // hand a login to a child, so it is where it has to be said.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/part of Pro/i);
    await expect(dialog).toContainText(/never be able to see or set their password/i);
    await expect(dialog).toContainText(/under 13/i);

    await page.getByPlaceholder('them@example.com').fill(memberEmail);
    await page.getByRole('button', { name: 'Send invite' }).click();

    // Pending, not active -- the membership does not exist until the invitee acts.
    await expect(page.getByText('INVITED')).toBeVisible();
    await expect(page.getByText('HAS LOGIN')).toHaveCount(1); // the owner's own, unchanged

    // Sam opens the link on the same device.
    const { inviteId, token } = await latestInvite(request, ownerEmail);
    await logout(page);
    await page.goto(`/join?i=${inviteId}&t=${encodeURIComponent(token)}`);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Join household' }).click();

    // Straight in, as a member, on their own person -- no second sign-in step.
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.locator('.app-chrome').getByRole('button', { name: 'Sam', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');

    // And the member's Profile tells them who to ask, which is what makes every refusal in the app
    // actionable.
    await openProfile(page);
    await expect(page.getByText(/Nate owns this household/)).toBeVisible();
    await expect(page.getByText(/cannot see or set your password/)).toBeVisible();
    // Household management is hidden for a member, not greyed out.
    await expect(page.getByText('Logins', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Danger zone')).toHaveCount(0);
  });

  test('the owner sees the login as active once it is accepted', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    const memberEmail = `huddle+e2e-member-${Date.now()}@starner.co`;

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

    // Back as the owner: Sam now HAS LOGIN, and there is nothing left to invite.
    await logout(page);
    await loginAs(page, ownerEmail, 'password123');
    await openProfile(page);
    await expect(page.getByText('HAS LOGIN')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Enable login' })).toHaveCount(0);
  });

  // A link that is stale, truncated or already used says one thing, and it is the same thing --
  // distinguishing them tells whoever holds a bad link which part to keep trying.
  test('a bad invite link is refused without saying why', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await logout(page);

    await page.goto('/join?i=999999&t=not-a-real-token');
    await page.getByRole('button', { name: 'Join household' }).click();

    await expect(page.getByRole('alert')).toContainText(/no longer valid/i);
    await expect(page).not.toHaveURL(/\/app\//);
  });
});
