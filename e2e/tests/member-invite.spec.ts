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
  //
  // Said on ARRIVAL now, with no form to fill in first: the page asks the server what this
  // invitation wants before it can ask the right question, so a dead link is known before anybody
  // types a password into it.
  test('a bad invite link is refused without saying why', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await logout(page);

    await page.goto('/join?i=999999&t=not-a-real-token');

    await expect(page.getByRole('alert')).toContainText(/no longer valid/i);
    await expect(page.getByRole('button', { name: 'Join household' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/app\//);
  });

  /**
   * ⚠️ THE HOLE THIS CLOSED, end to end.
   *
   * An address that already has a Huddle account used to be handed a full session on the strength
   * of the emailed link alone -- no password, none asked for, one supplied silently ignored. Since
   * `POST /api/auth/session` takes a session token, whoever held the link could then reach every
   * household that person belonged to, their own included.
   *
   * So: the link alone gets you nowhere, the RIGHT password joins, and what greets you afterwards
   * is the household picker -- the same screen a multi-household sign-in lands on, which is the
   * whole reason this flow needs no journey of its own.
   */
  test('an invitee who already has a household must sign in, then picks where to go', async ({ page, request }) => {
    // Sam already owns a household of their own.
    const samEmail = await registerHousehold(page, request, 'Sam');
    await logout(page);

    // Nate invites that same address.
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Sam');
    await openProfile(page);
    await page.getByRole('button', { name: 'Enable login' }).click();
    await page.getByPlaceholder('them@example.com').fill(samEmail);
    await page.getByRole('button', { name: 'Send invite' }).click();
    // ⚠️ The owner sees exactly what they would for an unknown address. An owner-visible
    // difference here is the user-enumeration oracle the whole invite design exists to avoid.
    await expect(page.getByText('INVITED')).toBeVisible();

    const { inviteId, token } = await latestInvite(request, ownerEmail);
    await logout(page);
    await page.goto(`/join?i=${inviteId}&t=${encodeURIComponent(token)}`);

    // Asked to SIGN IN, not to choose a password -- and told which address was invited.
    await expect(page.getByPlaceholder('Your Huddle password')).toBeVisible();
    await expect(page.getByPlaceholder('At least 8 characters')).toHaveCount(0);
    await expect(page.getByLabel('Email')).toHaveValue(samEmail);

    // The wrong password joins nothing, and does not sign anybody out.
    await page.getByPlaceholder('Your Huddle password').fill('not-sams-password');
    await page.getByRole('button', { name: 'Join household' }).click();
    await expect(page.getByRole('alert')).toContainText(/didn't match/i);
    await expect(page).toHaveURL(/\/join/);

    // The right one joins -- and lands on the picker rather than dropping them into a household
    // they never chose.
    await page.getByPlaceholder('Your Huddle password').fill('password123');
    await page.getByRole('button', { name: 'Join household' }).click();
    await expect(page.getByRole('heading', { name: /choose a household/i })).toBeVisible();
    // Both are on offer, labelled with THEIR role in each -- registration names a household
    // "<person>'s Household", so these are Sam's own and Nate's.
    await expect(page.getByRole('button', { name: "Sam's Household" })).toContainText('you own this');
    await expect(page.getByRole('button', { name: "Nate's Household" })).toContainText('you’re a member');

    await page.getByRole('button', { name: "Nate's Household" }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    // Both households are reachable from the account menu, which is where they were told to look.
    await page.locator('.header-bar').getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: /Switch to/ })).toBeVisible();
  });

  /**
   * ⚠️ A DEAD INVITE LINK MUST NOT SIGN A BYSTANDER OUT.
   *
   * Every invite refusal used to be a 401, and `api/client.js` reads ANY 401 on a request carrying
   * a token as "your session expired" -- clearing it and force-navigating to /login, with no
   * per-route opt-out. The browser attaches the session token to this call whether or not it is
   * needed, so somebody signed in who opened a stale, mistyped or already-used link was thrown out
   * of their own working session and never even saw the reason.
   *
   * ⚠️ The rest of this file CANNOT catch that: every other spec calls logout(page) before opening
   * a link. Signed IN is the whole condition. Same shape as
   * docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md.
   */
  test('a dead invite link opened while signed in does not end that session', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // Deliberately NOT logged out.
    await page.goto('/join?i=999999&t=not-a-real-token');
    await expect(page.getByRole('alert')).toContainText(/no longer valid/i);

    // Still signed in: back into the app with no sign-in step.
    await page.goto('/app/log');
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  /**
   * ⚠️ NEVER SILENTLY SWAP IDENTITY. Accepting replaced the signed-in session wholesale, so
   * opening Sam's link on Nate's iPad -- the likeliest way this ever happens -- signed Nate out and
   * Sam in with no confirmation and nothing on screen to explain it.
   */
  test('an invite for somebody else names both people instead of swapping identity', async ({ page, request }) => {
    const samEmail = await registerHousehold(page, request, 'Sam');
    await logout(page);

    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Sam');
    await openProfile(page);
    await page.getByRole('button', { name: 'Enable login' }).click();
    await page.getByPlaceholder('them@example.com').fill(samEmail);
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('INVITED')).toBeVisible();

    // Nate stays signed in and opens Sam's link on his own device.
    const { inviteId, token } = await latestInvite(request, ownerEmail);
    await page.goto(`/join?i=${inviteId}&t=${encodeURIComponent(token)}`);

    await expect(page.getByText(/This invitation is for/)).toBeVisible();
    await expect(page.getByRole('button', { name: `Sign in as ${samEmail}` })).toBeVisible();
    // Nothing offered to accept it as the wrong person.
    await expect(page.getByRole('button', { name: 'Join household' })).toHaveCount(0);

    // Staying put leaves Nate exactly where he was, and the invitation still live.
    await page.getByRole('button', { name: `Stay signed in as ${ownerEmail}` }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await openProfile(page);
    await expect(page.getByText('INVITED')).toBeVisible();

    // The other door: signing out of Nate's session must land on the JOIN form, not bounce to
    // /login. /join sits outside ProtectedRoute and logout() does not navigate, so the link stays
    // usable in place -- otherwise "sign in as somebody else" would throw the invitation away.
    await page.goto(`/join?i=${inviteId}&t=${encodeURIComponent(token)}`);
    await page.getByRole('button', { name: `Sign in as ${samEmail}` }).click();
    await expect(page).toHaveURL(/\/join/);
    await expect(page.getByPlaceholder('Your Huddle password')).toBeVisible();

    // And it still works from there.
    await page.getByPlaceholder('Your Huddle password').fill('password123');
    await page.getByRole('button', { name: 'Join household' }).click();
    await expect(page.getByRole('heading', { name: /choose a household/i })).toBeVisible();
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

  /**
   * The exact bug reported live: a wrong CURRENT password silently signed the person out to
   * /login instead of saying so. This route only ever 200s with a session token already attached
   * -- see PasswordChangeService's comment -- so answering the mismatch with a 401 read to the
   * client as "the session itself is invalid" and force-logged-out a session that was never in
   * question. docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md.
   */
  test('a wrong current password is refused in place, without signing the person out', async ({ page, request }) => {
    const { memberEmail } = await giveSamALogin(page, request);

    await openProfile(page);
    await page.getByRole('button', { name: 'Change' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Current password').fill('not-the-right-password');
    await dialog.getByLabel('New password', { exact: true }).fill('a-brand-new-one');
    await dialog.getByLabel('Confirm new password').fill('a-brand-new-one');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByRole('alert')).toContainText("That isn't your current password.");
    // Still on the same screen, in the same dialog -- not bounced to /login.
    await expect(page).toHaveURL(/\/app\//);
    await expect(dialog).toBeVisible();

    // The account is untouched: the original password still works.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await logout(page);
    await loginAs(page, memberEmail, 'password123');
  });

});
