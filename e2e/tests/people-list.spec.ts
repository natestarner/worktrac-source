import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold, setBillingPlan } from './support/auth';
import { addPerson } from './support/people';
import { failNetwork } from './support/faults';
import { forEachConnectivityMode } from './support/parity';
import { closePersonSheet, openPersonSheet, peopleList, personTag, signedInRows } from './support/peopleList';

// Profile's People list (PeopleSection.jsx): one row per person, with how they sign in and what
// they may do readable without opening anything, and a sheet per person for changing it. It
// replaced two sections (People and Logins) that listed the same people twice.

async function openProfile(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await expect(peopleList(page)).toBeVisible();
}

async function apiUrlOf(request: APIRequestContext): Promise<string> {
  return (await (await request.get('/config.json')).json()).apiUrl;
}

// Makes a login trusted over the real endpoint, signed in as the owner over the API -- for the
// cases whose subject is what the list SHOWS, not the owner's toggle (which member-trusted drives).
async function trustViaApi(request: APIRequestContext, ownerEmail: string, personName: string) {
  const apiUrl = await apiUrlOf(request);
  const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email: ownerEmail, password: 'password123' } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const rows = await (await request.get(`${apiUrl}/api/account/logins`, { headers })).json();
  const row = rows.find((r: { personName: string }) => r.personName === personName);
  const response = await request.put(`${apiUrl}/api/account/logins/${row.personId}/role`, { headers, data: { role: 'MANAGER' } });
  expect(response.status(), await response.text()).toBe(200);
}

test.describe('The People list', () => {
  // One motion for somebody who does not exist yet: name + email, one request, and the row says
  // what happened without opening anything.
  test('adds a person with a login in one step, and the row says the invite went out', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PLUS');
    await page.reload();
    await openProfile(page);

    await peopleList(page).getByRole('button', { name: 'Add a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await dialog.getByLabel('Name').fill('Dana');
    await dialog.getByPlaceholder('them@example.com').fill('huddle+e2e-dana@starner.co');
    await dialog.getByRole('button', { name: 'Add and send invite' }).click();
    await expect(dialog).toBeHidden();

    await expect(peopleList(page).getByText('Invite sent to huddle+e2e-dana@starner.co', { exact: true })).toBeVisible();
    await expect(personTag(page, 'Invited')).toHaveCount(1);
    // The owner's own row: who they are and how they sign in, at a glance.
    await expect(personTag(page, 'Owner')).toHaveCount(1);
    await expect(personTag(page, 'You')).toHaveCount(1);
    await expect(signedInRows(page)).toHaveCount(1);

    // The invite's controls are in Dana's sheet, beside the facts they act on.
    const sheet = await openPersonSheet(page, 'Dana');
    await expect(sheet.getByRole('button', { name: 'Resend' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Withdraw invite' })).toBeVisible();
    // ...and, in its own block, the one that deletes the person.
    await expect(sheet.getByRole('button', { name: 'Remove Dana' })).toBeVisible();
  });

  // ⚠️ The roster comes from the auth snapshot; only the login facts are a live read. A failed
  // read must cost the rows their login line, never the rows themselves -- the old Logins section
  // rendered nothing at all, which was tolerable for one feature and is not for the only roster.
  test('keeps everyone listed when the login details cannot be loaded, and says why', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PLUS');
    await addPerson(page, 'Sam');

    await failNetwork(page, /\/api\/account\/logins$/);
    await openProfile(page);

    await expect(peopleList(page).getByText(/Login details need a connection/).first()).toBeVisible();
    for (const name of ['Nate', 'Sam']) {
      await expect(peopleList(page).getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();
    }
    await expect(signedInRows(page)).toHaveCount(0);

    const sheet = await openPersonSheet(page, 'Sam');
    await expect(sheet.getByText('Login details need a connection.', { exact: true })).toBeVisible();
    // Renaming does not depend on the failed read, so it is still offered.
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('Sam');
  });
});

// What the list shows depends on WHO is looking. These are the cases whose controls are decided
// per viewer and per login state -- each one a control the server would refuse if it were offered.
test.describe('The People list, by viewer and login state', () => {
  // A trusted member manages people but owns nothing about the account: no row of the owner's to
  // change, no Trusted toggle for anyone, nobody to remove.
  test("a trusted member sees who is trusted, can't touch the owner's row, and can remove nobody", async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Jess');
    await addPerson(page, 'Leo');
    const jess = await addMemberLogin(page, request, ownerEmail, 'Jess');
    await addMemberLogin(page, request, ownerEmail, 'Leo');
    await trustViaApi(request, ownerEmail, 'Jess');

    await loginAs(page, jess.email, jess.password);
    await openProfile(page);

    // At a glance: Jess is marked trusted and as the viewer; the owner is marked the owner.
    await expect(personTag(page, 'Trusted')).toHaveCount(1);
    await expect(personTag(page, 'You')).toHaveCount(1);
    await expect(personTag(page, 'Owner')).toHaveCount(1);
    await expect(signedInRows(page)).toHaveCount(3);

    // The owner's row is a plain row: nothing on it is Jess's to change.
    await expect(peopleList(page).getByRole('button', { name: 'Edit Nate', exact: true })).toHaveCount(0);
    await expect(peopleList(page).getByText('Nate', { exact: true })).toBeVisible();

    // Leo's sheet: rename and remove his LOGIN, but no Trusted toggle and no removing Leo himself.
    const leo = await openPersonSheet(page, 'Leo');
    await expect(leo.getByRole('textbox', { name: 'Name' })).toBeVisible();
    await expect(leo.getByRole('button', { name: 'Remove login' })).toBeVisible();
    await expect(leo.getByRole('checkbox')).toHaveCount(0);
    await expect(leo.getByRole('button', { name: 'Remove Leo' })).toHaveCount(0);
    await closePersonSheet(leo);

    // Jess's own sheet: her login is not hers to remove (the server refuses it).
    const own = await openPersonSheet(page, 'Jess');
    await expect(own.getByText(/Trusted/).first()).toBeVisible();
    await expect(own.getByRole('button', { name: 'Remove login' })).toHaveCount(0);
  });

  // Pro keeps its own word for the same role, on the row and on the toggle.
  test('a trainer sees an assistant called an Assistant, on the row and in the sheet', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Pat');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Ava');
    await addPerson(page, 'Ben');
    await addMemberLogin(page, request, ownerEmail, 'Ava', undefined, 'PRO');
    await addMemberLogin(page, request, ownerEmail, 'Ben', undefined, 'PRO');
    await trustViaApi(request, ownerEmail, 'Ava');
    await page.reload();
    await openProfile(page);

    await expect(personTag(page, 'Assistant')).toHaveCount(1);
    await expect(personTag(page, 'Trusted')).toHaveCount(0);

    const ben = await openPersonSheet(page, 'Ben');
    await expect(ben.getByRole('checkbox', { name: 'Assistant: Ben' })).not.toBeChecked();
    await expect(ben.getByText(/everyone in the practice/)).toBeVisible();
  });

  // The owner is the support desk: a locked-out member shows as Locked without losing their
  // "Signs in as" line, and Unlock clears it.
  test('the owner sees a locked-out login on the row and unlocks it from the sheet', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    const sam = await addMemberLogin(page, request, ownerEmail, 'Sam');

    // AuthService.MAX_FAILED_LOGINS is 10; one more than that locks it.
    const apiUrl = await apiUrlOf(request);
    for (let i = 0; i < 11; i += 1) {
      await request.post(`${apiUrl}/api/auth/login`, { data: { email: sam.email, password: 'not-the-password' } });
    }

    await page.reload();
    await openProfile(page);
    await expect(personTag(page, 'Locked')).toHaveCount(1);
    await expect(signedInRows(page)).toHaveCount(2);

    const sheet = await openPersonSheet(page, 'Sam');
    await sheet.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Sam can try signing in again.', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
    await closePersonSheet(sheet);
    await expect(personTag(page, 'Locked')).toHaveCount(0);

    // ...and the right password works again.
    const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email: sam.email, password: sam.password } });
    expect(login.status()).toBe(200);
  });

  // Renaming moved from its own modal into the sheet; the new name has to reach both the list and
  // the person bar, which read the same people.
  test('renames a person from their sheet, everywhere at once', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    await openProfile(page);

    const sheet = await openPersonSheet(page, 'Sam');
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
    await sheet.getByRole('textbox', { name: 'Name' }).fill('Samuel');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Name saved.', { exact: true })).toBeVisible();
    await closePersonSheet(page.getByRole('dialog', { name: 'Samuel', exact: true }));

    await expect(peopleList(page).getByRole('button', { name: 'Edit Samuel', exact: true })).toBeVisible();
    await expect(peopleList(page).getByRole('button', { name: 'Edit Sam', exact: true })).toHaveCount(0);
    await expect(page.locator('.app-chrome').getByRole('button', { name: 'Samuel', exact: true })).toBeVisible();
  });
});

// The roster itself reads the same in every mode: it is built from what the device already holds.
// What a degraded mode may lose is only the per-row login line (a live read), which is why the
// assertion is about the people, not their logins.
forEachConnectivityMode<void>('the People list lists everyone', {
  async setup(page, request) {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PLUS');
    await addPerson(page, 'Sam');
    await addPerson(page, 'Leo');
    // The offline warm (History included) finishes online, as it would on a real device that had
    // been open a moment -- parity.ts ends every mode by comparing the held History to the server's.
    await page.waitForLoadState('networkidle');
  },

  async navigate(page) {
    await openProfile(page);
  },

  // Opening a sheet is not a write, so it is not gated: it must open in every mode, holding the
  // person's own name.
  async act(page) {
    for (const name of ['Nate', 'Sam', 'Leo']) {
      await expect(peopleList(page).getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();
    }
    await openPersonSheet(page, 'Sam');
  },

  async assert(page) {
    const sheet = page.getByRole('dialog', { name: 'Sam', exact: true });
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('Sam');
    // Closed before the harness restores the mode: pinned-offline leaves through the banner, which
    // an open dialog covers.
    await closePersonSheet(sheet);
  },
});
