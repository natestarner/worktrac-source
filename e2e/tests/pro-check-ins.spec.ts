import { expect, test } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold, setBillingPlan, setMemberVisibility } from './support/auth';
import { addPerson } from './support/people';

// Check-ins through the browser, and above all the one thing that must never be wrong: a client
// must not read what their trainer wrote privately about them.
//
// CheckInTest pins that at the API, including the WRITE_OTHER_PEOPLE-vs-VIEW_OTHER_PEOPLE
// distinction. What only a browser proves is that the two surfaces are actually wired to it -- a
// leak here renders as an ordinary timeline entry, indistinguishable from one written for them.
test.describe('Pro — check-ins', () => {

  async function openCheckIns(page) {
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Check-ins' }).click();
  }

  async function writeCheckIn(page, body, { keepPrivate = false } = {}) {
    const field = page.getByLabel(/How did it go/);
    // ⚠️ Wait for the form to be READY before typing. A successful save clears the draft, and that
    // clear lands a tick after the entry appears in the list -- so typing the instant the previous
    // entry renders can be wiped by it. This is a real synchronisation point, not a workaround: an
    // empty field IS the signal that the last save finished settling.
    await expect(field).toHaveValue('');
    await field.fill(body);
    // The field itself, then the button. Clicking a disabled button just times out with no clue
    // which half went wrong -- this says whether the text reached the draft or the save is busy.
    await expect(field).toHaveValue(body);
    const save = page.getByRole('button', { name: 'Save check-in' });
    await expect(save).toBeEnabled();
    if (keepPrivate) {
      await page.getByRole('checkbox').check();
    }
    await save.click();
    await expect(page.getByText(body)).toBeVisible();
  }

  // ⚠️ THE ASSERTION THIS FEATURE LIVES OR DIES ON.
  test('a private observation never reaches the client it is about', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Dana');
    const dana = await addMemberLogin(page, request, ownerEmail, 'Dana', undefined, 'PRO');
    await setMemberVisibility(request, ownerEmail, false);
    await page.reload();

    // The trainer, on Dana's person, writes one of each.
    await page.locator('.app-chrome').getByRole('button', { name: 'Dana', exact: true }).click();
    await openCheckIns(page);
    await writeCheckIn(page, 'Knee still bothering her', { keepPrivate: true });
    // ⚠️ Deliberately back-to-back, with no reload between them. Writing two in a row is what
    // caught the form staying disabled after a successful save -- awaiting the invalidation kept
    // the write "pending", and pending disables the button.
    await writeCheckIn(page, 'Great session today');

    // The private one is marked, so the trainer can tell while reading which entries Dana can see.
    await expect(page.getByText(/only you/)).toBeVisible();

    await loginAs(page, dana.email, dana.password);
    await openCheckIns(page);

    await expect(page.getByText('Great session today')).toBeVisible();
    await expect(page.getByText('Knee still bothering her')).toHaveCount(0);
  });

  // The other half of the same table: a client's own check-in is theirs, and their trainer sees it.
  test('a client writes their own and the trainer reads it', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Dana');
    const dana = await addMemberLogin(page, request, ownerEmail, 'Dana', undefined, 'PRO');
    await setMemberVisibility(request, ownerEmail, false);

    await loginAs(page, dana.email, dana.password);
    await openCheckIns(page);
    await page.getByLabel(/Body weight/).fill('182.5');
    await writeCheckIn(page, 'Felt strong today');

    await expect(page.getByText('182.5 lb')).toBeVisible();
    // ⚠️ A person cannot hide an entry from themselves, so the control is not there to tick.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });

  // ⚠️ This is the THIRD note concept in the app -- "standing note" and "note for this session"
  // already exist -- and Playwright matches accessible names as a case-insensitive substring. A
  // control called "note" here would collide with them and read as a fourth concept.
  test('never calls anything a note', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    await openCheckIns(page);

    await expect(page.getByRole('button', { name: /note/i })).toHaveCount(0);
    await expect(page.getByLabel(/note/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save check-in' })).toBeVisible();
  });

  // An entry with neither a weight nor anything written records nothing. The button refuses before
  // the request is made -- the server would answer 400, and a 400 on a write with no content is
  // correct but pointless to reach.
  test('will not save an empty check-in', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    await openCheckIns(page);

    await expect(page.getByRole('button', { name: 'Save check-in' })).toBeDisabled();
  });
});
