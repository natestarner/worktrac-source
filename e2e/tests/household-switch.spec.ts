import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { outboxCountText, waitForOutboxDrain } from './support/offline';
import { failNetwork } from './support/faults';

const LIVE_SETS = /^https?:\/\/[^/]+\/api\/people\/\d+\/live-sets/;

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
}

async function openAccountMenu(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
}

async function logout(page: Page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

function personPill(page: Page, name: string) {
  return page.locator('.app-chrome').getByRole('button', { name, exact: true });
}

/**
 * One credential, two households — the shape phase 6 exists for.
 *
 * Built by registering household A, then attaching that SAME email to household B as a member. The
 * invite flow that will normally produce this does not exist until phase 7, so the profile-gated
 * test-support route stands in; what it creates is a real second membership on a real single user
 * row, which is exactly what the picker and the switch have to cope with.
 */
async function twoHouseholds(page: Page, request: APIRequestContext) {
  const sharedEmail = await registerHousehold(page, request, 'Alex');
  await logout(page);

  const otherOwnerEmail = await registerHousehold(page, request, 'Robin');
  await addPerson(page, 'Sam');
  await addMemberLogin(page, request, otherOwnerEmail, 'Sam', sharedEmail);
  await logout(page);

  return { sharedEmail, password: 'password123' };
}

test.describe('One login, two households', () => {
  test('signing in offers a picker, and choosing one lands in it', async ({ page, request }) => {
    const { sharedEmail, password } = await twoHouseholds(page, request);

    await page.goto('/login');
    await page.getByPlaceholder('Email', { exact: true }).fill(sharedEmail);
    await page.getByPlaceholder('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();

    // Not signed in yet -- the picker stands between the password and a session.
    await expect(page.getByRole('heading', { name: 'Choose a household' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/app\//);

    // Each household is named, and labelled by THIS login's role in it -- the fastest way to tell
    // "the one I run" from "the one I was invited to" when both are named after a family.
    await expect(page.getByRole('button', { name: /you own this/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /you.re a member/ })).toBeVisible();

    await page.getByRole('button', { name: /you own this/ }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    // The account-menu trigger, not a person pill: household A has ONE person, and PersonPillBar
    // deliberately hides itself below two. The trigger carries the primary person's name, so it is
    // the assertion that works whatever the household size.
    await expect(page.locator('.header-bar').getByRole('button', { name: /Alex/ })).toBeVisible();
  });

  // The other household is reached from the account menu, named, so with two households the menu
  // IS the picker and there is no second screen to walk through.
  test('the account menu switches to the other household', async ({ page, request }) => {
    const { sharedEmail, password } = await twoHouseholds(page, request);

    await page.goto('/login');
    await page.getByPlaceholder('Email', { exact: true }).fill(sharedEmail);
    await page.getByPlaceholder('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: /you own this/ }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await openAccountMenu(page);
    // Never the household already open -- offering it would be a control that does nothing.
    await expect(page.getByRole('menuitem', { name: /Switch to Alex/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: /^Switch to / }).click();

    // A different household's data entirely: its own people, not household A's.
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(personPill(page, 'Sam')).toBeVisible();
    await expect(personPill(page, 'Alex')).toHaveCount(0);
  });

  /**
   * ⚠️ SWITCHING SUSPENDS QUEUED WRITES; IT MUST NEVER DISCARD THEM.
   *
   * Logging out clears this device's outbox, deliberately and behind a confirm. Switching household
   * does not: `adoptOutboxScope` flips the scope pointer to the incoming household BEFORE evicting
   * the mutation cache, so the outgoing household's writes stay on their own IndexedDB key and come
   * back on the way in.
   *
   * That only holds because of phase 4's `reconciledKey` guard — without it the eviction persists
   * "empty" against the household being switched INTO and deletes its queue. Household switching is
   * the flow most likely to hit that, since both sides routinely have work waiting.
   */
  test('queued work waits for the household it belongs to, and lands on return', async ({ page, request }) => {
    const { sharedEmail, password } = await twoHouseholds(page, request);

    await page.goto('/login');
    await page.getByPlaceholder('Email', { exact: true }).fill(sharedEmail);
    await page.getByPlaceholder('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: /you own this/ }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    // Queue a set in household A that cannot reach the server. failNetwork rather than
    // goHardOffline: switching household needs the network to mint a token, so the whole browser
    // cannot be offline -- only this one write may be stuck.
    const blocked = await failNetwork(page, LIVE_SETS);
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Switching is told about it -- and told it is SUSPENDED, not lost.
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: /^Switch to / }).click();
    const notice = page.getByRole('alertdialog', { name: 'Unsynced changes' });
    await expect(notice).toContainText(/sync when you switch back/i);
    await expect(notice).not.toContainText(/lost/i);
    await page.getByRole('menuitem', { name: 'Switch anyway' }).click();

    // Household B carries none of it: A's queue is on A's own key, not inherited here.
    await expect(personPill(page, 'Sam')).toBeVisible();
    await expect(page.getByText(/waiting to sync/i)).toBeHidden();

    // Back to A, and the write is still theirs -- restored on the way in, and it lands.
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: /^Switch to / }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    blocked.stop();
    await waitForOutboxDrain(page);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press', { exact: true }).first()).toBeVisible();
  });

  // A single-household login must see none of this. The overwhelmingly common path has to be
  // untouched, and an entry that does nothing is worse than no entry.
  test('a login with one household never sees a picker or a switch entry', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');

    await openAccountMenu(page);
    await expect(page.getByRole('menuitem', { name: /^Switch to / })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Logout' })).toBeVisible();
  });
});
