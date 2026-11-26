import { APIRequestContext, Page, expect, test } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold } from './support/auth';
import { logSetAt, pickExercise, searchTrigger } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';
import { closePersonSheet, openPersonSheet, personTag } from './support/peopleList';

// A "trusted" login (AccountRole.MANAGER, made assignable on Plus): a second adult sharing the iPad
// who logs for themselves AND the kids, but never over the owner's own workouts. TrustedLoginTest
// covers every status code; what only a browser can prove is that the owner can actually turn it
// on, and that the trusted login's screens match what the server allows -- the kid's controls live,
// the owner's read-only with a sentence naming whose they are.

const EXERCISE = 'Barbell Bench Press';

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
}

// The person pills live in the sticky chrome; the bare name also matches the account menu trigger.
async function switchTo(page: Page, name: string) {
  await page.locator('.app-chrome').getByRole('button', { name, exact: true }).click();
}

// Turns trust on over the real endpoint, signed in as the owner over the API -- for the specs whose
// subject is what the trusted login can DO, not the owner's toggle (which the first test drives).
async function trustViaApi(request: APIRequestContext, ownerEmail: string, personName: string) {
  const { apiUrl } = await (await request.get('/config.json')).json();
  const login = await request.post(`${apiUrl}/api/auth/login`, {
    data: { email: ownerEmail, password: 'password123' },
  });
  expect(login.status()).toBe(200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const rows = await (await request.get(`${apiUrl}/api/account/logins`, { headers })).json();
  const row = rows.find((r: { personName: string }) => r.personName === personName);
  const response = await request.put(`${apiUrl}/api/account/logins/${row.personId}/role`, {
    headers,
    data: { role: 'MANAGER' },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test.describe('Trusted logins', () => {
  test('the owner makes a login trusted, and it can then log for a kid but not the owner', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Jess');
    await addPerson(page, 'Leo');
    const jess = await addMemberLogin(page, request, ownerEmail, 'Jess');

    // The owner's toggle, through the real Profile screen. A reload first so the list reflects the
    // login the test route just made.
    await page.reload();
    await page.locator('.header-bar').getByRole('button', { name: /^Nate/ }).click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    // Nobody is trusted yet, and the list says so without opening anything.
    await expect(personTag(page, 'Trusted')).toHaveCount(0);
    const sheet = await openPersonSheet(page, 'Jess');
    const toggle = sheet.getByRole('checkbox', { name: 'Trusted: Jess' });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    // It asks first, and says what it grants.
    await expect(page.getByText(/log, edit and delete workouts for everyone in this household except you/)).toBeVisible();
    await page.getByRole('button', { name: 'Make trusted' }).click();
    await expect(toggle).toBeChecked();
    // ...and the row behind the sheet now carries it, at a glance.
    await closePersonSheet(sheet);
    await expect(personTag(page, 'Trusted')).toHaveCount(1);

    // Jess signs in on the shared iPad.
    await loginAs(page, jess.email, jess.password);

    // Profile names the role in the family's word.
    await page.locator('.header-bar').getByRole('button', { name: /^Jess/ }).click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page.getByText('Trusted member', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();

    // Leo (no login): fully live, exactly as for Jess herself.
    await switchTo(page, 'Leo');
    await page.getByRole('link', { name: 'History' }).click();
    // A positive signal before asserting an absence.
    await expect(page.getByRole('button', { name: 'Log a past workout' })).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: 'Viewing' })).toHaveCount(0);

    // Nate (the owner): read-only, and the sentence says whose they are rather than "only your own".
    await switchTo(page, 'Nate');
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'only Nate can change them' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log a past workout' })).toBeDisabled();
  });

  // The refusal on the owner's person must be a 403 through the real container -- a 401 would sign
  // the trusted login out (see member-permissions.spec.ts's equivalent for members).
  test('a write to the owner is refused with 403 and the session survives', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Jess');
    const jess = await addMemberLogin(page, request, ownerEmail, 'Jess');
    await trustViaApi(request, ownerEmail, 'Jess');
    await loginAs(page, jess.email, jess.password);

    const { apiUrl } = await (await request.get('/config.json')).json();
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    const headers = { Authorization: `Bearer ${token}` };
    const me = await (await request.get(`${apiUrl}/api/auth/me`, { headers })).json();
    expect(me.membership.accountRole).toBe('MANAGER');

    const refused = await request.put(`${apiUrl}/api/people/${me.membership.ownerPersonId}/rest-timer-preference`, {
      headers,
      data: { enabled: false },
      failOnStatusCode: false,
    });
    expect(refused.status()).toBe(403);

    await page.reload();
    await expect(page).toHaveURL(/\/app\//);
  });
});

// The whole point of the feature, in every connectivity mode: a trusted login logs a set for a kid
// on the shared iPad. Logging is the durable outbox path, unchanged -- this proves the person guard
// lets the queued write land for a person who is not the login's own.
forEachConnectivityMode<void>('a trusted login logs a set for a kid', {
  async setup(page, request) {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Jess');
    await addPerson(page, 'Leo');
    const jess = await addMemberLogin(page, request, ownerEmail, 'Jess');
    await trustViaApi(request, ownerEmail, 'Jess');
    await loginAs(page, jess.email, jess.password);
    // Leo's picker and History warmed online, before the mode cuts the network.
    await switchTo(page, 'Leo');
    await expect(searchTrigger(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
  },

  async navigate(page) {
    await switchTo(page, 'Leo');
    await pickExercise(page, EXERCISE);
  },

  async act(page) {
    await logSetAt(page, 95, 8);
  },

  // Mode-independent: the set is on Leo's screen and nothing about it is read-only.
  async assert(page) {
    await expect(page.getByText('Set 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Viewing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();
  },

  async afterReconnect(page, _state) {
    // The queued write reached the server under Jess's token, for Leo.
    const apiUrl = await page.evaluate(async () => (await (await fetch('/config.json')).json()).apiUrl);
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    await expect.poll(async () => page.evaluate(async ({ apiUrl, token }) => {
      const headers = { Authorization: `Bearer ${token}` };
      const me = await (await fetch(`${apiUrl}/api/auth/me`, { headers })).json();
      const leo = me.people.find((p: { name: string }) => p.name === 'Leo');
      const history = await (await fetch(`${apiUrl}/api/people/${leo.id}/history`, { headers })).json();
      return history.length;
    }, { apiUrl, token })).toBe(1);
  },
});
