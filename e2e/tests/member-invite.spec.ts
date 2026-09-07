import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAs, registerHousehold, setBillingPlan } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';

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

/**
 * Gets Sam a real, working login and leaves the page signed in AS SAM.
 *
 * Everything here is the real flow bar the token lookup -- a real invite, a real token check, a
 * real membership. Returns both addresses because the specs below need to sign back and forth.
 */
async function giveSamALogin(page: Page, request: APIRequestContext) {
  const ownerEmail = await registerHousehold(page, request, 'Nate');
  await setBillingPlan(request, ownerEmail, 'PRO');
  await addPerson(page, 'Sam');
  // randomUUID, not Date.now(): two specs starting in the same millisecond on two
  // workers produced the same address, and the second one's invite went astray. The
  // failure landed on an unrelated pre-existing spec, which is what made it confusing.
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

test.describe('Enabling a member login', () => {
  test('an owner invites, the invitee joins, and lands as a member', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    // Inviting is refused on Free -- an invitation whose successful path is a paused
    // login is a promise the product cannot keep.
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Sam');
    const memberEmail = `huddle+e2e-member-${randomUUID().slice(0, 8)}@starner.co`;

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
    // Inviting is refused on Free -- an invitation whose successful path is a paused
    // login is a promise the product cannot keep.
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Sam');
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

  /**
   * ⚠️ THE PROMISE THE REVOKE CONFIRMATION MAKES, CHECKED END TO END.
   *
   * The dialog tells the owner that the person and their workouts stay. That sentence is the whole
   * reason an owner will act on it without hesitating, so it is worth proving through the real UI
   * rather than trusting the service test alone: Sam's set is still on the owner's screen
   * afterwards, and Sam's own password no longer opens anything.
   */
  test('removing a login keeps the person and their workouts, and ends their access', async ({ page, request }) => {
    const { ownerEmail, memberEmail } = await giveSamALogin(page, request);

    // Sam logs something, so there is real data to still be there at the end. Through the shared
    // helpers -- "Search all exercises" is a PLACEHOLDER, not a button name, and the stepper is a
    // stepper rather than a text input.
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 100, 5);

    await logout(page);
    await loginAs(page, ownerEmail, 'password123');
    await openProfile(page);

    // The confirm names both things that are not obvious.
    await page.getByRole('button', { name: 'Remove login' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(/workouts stay/i);
    await expect(confirm).toContainText(/haven't synced/i);
    await confirm.getByRole('button', { name: 'Remove login' }).click();

    // Sam is still in the household, with no login.
    await expect(page.getByText('HAS LOGIN')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Enable login' })).toBeVisible();

    // ...and their password opens nothing.
    await logout(page);
    await page.goto('/login');
    // Not loginAs(): that helper asserts the sign-in SUCCEEDS. The LoginPage placeholders are
    // Email/Password -- you@example.com belongs to RegisterPage, a different screen.
    await page.getByPlaceholder('Email', { exact: true }).fill(memberEmail);
    await page.getByPlaceholder('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).not.toHaveURL(/\/app\//);
  });

  /**
   * ⚠️ An owner must not be offered Remove on their own login. The server refuses it (409), but a
   * control that can only fail is its own bug -- and this is the assertion that would catch the
   * `isSelf` flag being dropped from the payload, which is exactly how it shipped the first time.
   */
  test('the owner is never offered Remove on their own login', async ({ page, request }) => {
    const { ownerEmail } = await giveSamALogin(page, request);

    await logout(page);
    await loginAs(page, ownerEmail, 'password123');
    await openProfile(page);

    // Two people hold a login here -- the owner and Sam -- but only ONE of them can be removed.
    //
    // ⚠️ 'Remove login', not 'Remove': the People roster on this same screen has its own Remove,
    // which deletes the person and everything they logged. Matching the bare word counts both and
    // this assertion silently stops meaning anything.
    await expect(page.getByText('HAS LOGIN')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove login' })).toHaveCount(1);
  });

  /**
   * Nate's question #4: there was no change-password screen anywhere in the app. It matters most
   * for a member, whose only alternative is a forgot-password email a parent may be able to read.
   */
  test('a member can change their own password and stays signed in', async ({ page, request }) => {
    const { memberEmail } = await giveSamALogin(page, request);

    await openProfile(page);
    await page.getByRole('button', { name: 'Change' }).click();

    const dialog = page.getByRole('dialog');
    // Said before they commit, not after.
    await expect(dialog).toContainText(/other device signed in as you will be signed out/i);

    // exact:true on the middle one -- 'New password' is a substring of 'Confirm new password',
    // so the loose match resolves to both fields and throws a strict-mode violation.
    await dialog.getByLabel('Current password').fill('password123');
    await dialog.getByLabel('New password', { exact: true }).fill('sams-own-password');
    await dialog.getByLabel('Confirm new password').fill('sams-own-password');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    // ⚠️ Still signed in. The change bumps token_version, so without the replacement session going
    // through establishSession this lands on /login -- signed out by their own success.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\//);
    await openProfile(page);
    await expect(page.getByText(/cannot see or set your password/)).toBeVisible();

    // The new password is the one that works now.
    await logout(page);
    await loginAs(page, memberEmail, 'sams-own-password');
    await expect(page).toHaveURL(/\/app\//);
  });

});
