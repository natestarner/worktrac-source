import { expect, test } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold, setMemberVisibility } from './support/auth';
import { addOwnExercise, backToPicker, pickExercise } from './support/exercises';

// The modal's field is placeholder "Name" and its confirm button is scoped to the dialog, because
// "Add" alone also matches controls behind it.
//
// ⚠️ Waits for the new person's PILL, not for the exercise picker. import.spec.ts's copy waits on
// "Search all exercises", which is already on screen for the CURRENT person -- so that wait can be
// satisfied before the modal has even closed. It is harmless there because the next steps take
// long enough anyway; here the very next call asks the SERVER for this person by name, and the
// race showed up immediately as an intermittent 404 that moved between tests on every run.
async function addPerson(page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
}

// A member login, driven through the real UI.
//
// The backend already has MemberPermissionsTest covering every route shape. What only a browser
// can prove is the half that lives above HTTP:
//
//   1. A 403 from PermissionInterceptor stays a 403. MockMvc structurally cannot catch this --
//      it performs no container-level error dispatch, and that dispatch is exactly what
//      re-runs the stateless security chain as anonymous and silently downgrades the 403 into a
//      401. A 401 is read by the frontend as "session invalid" and SIGNS THE PERSON OUT. So
//      without this assertion the feature ships looking green and logs members out instead of
//      refusing them. Deferred here from phase 1, which had no way to produce a denial at all
//      because every login was an owner.
//
//   2. That the read-only chrome actually reaches the screen -- the controls really are disabled
//      and the notice really is rendered, rather than a hook returning the right value into a
//      component nobody wired up.
test.describe('Member logins', () => {
  test('a member can log their own workouts but only view a sibling', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');

    await addPerson(page, 'Sam');

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await loginAs(page, member.email, member.password);

    // The account-menu trigger used to always print the household's PRIMARY person's name, which
    // for a member is somebody else -- so this read "Nate" while actually signed in as Sam.
    await expect(page.locator('.header-bar').getByRole('button', { name: /^Sam/ })).toBeVisible();

    // MANAGE_PEOPLE is owner-only and the server refuses the create outright -- the control must
    // not be offered at all, not merely fail once clicked.
    await expect(page.getByRole('button', { name: '+ Add person' })).toHaveCount(0);

    // Profile states plainly which role this login holds, rather than making someone infer it
    // from which controls are missing.
    await page.locator('.header-bar').getByRole('button', { name: /^Sam/ }).click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page.getByText('Role')).toBeVisible();
    await expect(page.getByText('Member', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();

    // Asserted on History rather than Log: "Log set" only exists once an exercise is selected,
    // whereas "Log a past workout" sits on the tab itself, so this measures the read-only chrome
    // without also depending on the picker flow.
    await page.getByRole('link', { name: 'History' }).click();

    // Their own screen is fully live -- no notice, and the write available.
    await expect(page.getByRole('status').filter({ hasText: 'Viewing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Log a past workout' })).toBeEnabled();

    // Switching to the sibling: the write control goes read-only, and the reason is on screen in
    // words rather than only as grey (there is no hover on the devices this app targets).
    // Scoped to the sticky chrome: the bare name also matches the account-menu trigger, which is
    // a strict-mode violation. .app-chrome is where PersonPillBar lives (see frontend-core.md).
    await page.locator('.app-chrome').getByRole('button', { name: 'Nate', exact: true }).click();
    // A person switch navigates to THAT person's own lastTab (AppShell), so this lands back on
    // Log rather than staying on History -- go back deliberately rather than assuming.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Viewing Nate' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Log a past workout' })).toBeDisabled();
  });

  // ⚠️ THE ASSERTION THAT CANNOT BE MADE ANYWHERE ELSE.
  test('a refused write answers 403, and never a 401 that would sign the member out', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');

    await addPerson(page, 'Sam');

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await loginAs(page, member.email, member.password);

    // Straight at the API with the member's own token, because the UI correctly refuses to offer
    // this. The point is what the SERVER answers, through a real container error dispatch.
    const { apiUrl } = await (await request.get('/config.json')).json();
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));

    const refused = await request.post(`${apiUrl}/api/people`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Sneaky' },
      failOnStatusCode: false,
    });

    expect(
      refused.status(),
      'A 403 downgraded to 401 signs the member out instead of refusing them -- see SecurityConfig',
    ).toBe(403);

    // And the session survives it: still signed in, still on the app.
    await page.reload();
    await expect(page).toHaveURL(/\/app\//);
  });

  // The backend's DeletingATag block in MemberPermissionsTest covers every status code this can
  // produce; what only a browser can prove is that the chrome actually matches: TagDto.deletable
  // decides whether the × even renders, for a tag the member made vs. one they didn't.
  test('a member can delete a tag they created while unused, but not the owner\'s', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');

    // The owner's own tag, created before switching -- the one a member must never be offered a
    // delete control on.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await page.getByPlaceholder('New tag name').fill('nate-push');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('nate-push')).toBeVisible();

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await loginAs(page, member.email, member.password);

    await page.locator('.header-bar').getByRole('button', { name: /^Sam/ }).click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();

    // Somebody else's tag: visible (it's shared), but no delete control offered at all.
    await expect(page.getByText('nate-push')).toBeVisible();
    await expect(page.getByRole('button', { name: '×', exact: true })).toHaveCount(0);

    // Their own, and nobody has applied it yet: deletable.
    await page.getByPlaceholder('New tag name').fill('sam-pull');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('sam-pull')).toBeVisible();
    await expect(page.getByRole('button', { name: '×', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: '×', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Delete tag "sam-pull"?');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('sam-pull')).toHaveCount(0);
    // Untouched by any of the above.
    await expect(page.getByText('nate-push')).toBeVisible();
  });

  // The Customize modal used to read `isGlobal` as authorship, so EVERY household exercise was
  // badged "Created by you" to whoever opened it -- and the rename field was offered on rows the
  // server refuses, auto-saving on blur straight into a 403. ExerciseDto.renamable is the server's
  // own answer now, the same role TagDto.deletable plays in the tag test above.
  //
  // ⚠️ Every assertion is scoped to the dialog. The exercise name is in ExerciseDetail's heading
  // behind the modal, and the creator's name is on the person pills -- both make a bare getByText
  // a strict-mode violation.
  test("a member is told who added an exercise, and is not offered a rename they cannot make", async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');

    // The owner's own exercise, created before the member exists.
    await addOwnExercise(page, 'Yoke Carry Press');
    await expect(page.getByRole('button', { name: 'Customize this exercise' })).toBeVisible();

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await loginAs(page, member.email, member.password);

    // Somebody else's exercise: named, and read-only.
    await pickExercise(page, 'Yoke Carry Press');
    await page.getByRole('button', { name: 'Customize this exercise' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Created by Nate');
    await expect(dialog).not.toContainText('Created by you');
    // The name is still readable -- only the control is gone, not the information.
    await expect(dialog).toContainText('Yoke Carry Press');
    await expect(dialog).toContainText('Only Nate or the account owner can rename this exercise.');
    await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
    // The point of the change: the name is TEXT, not a disabled textbox. Asserted directly on the
    // live values, because "is it in a field" is exactly what an absent Save button cannot prove.
    await expect
      .poll(async () =>
        dialog
          .locator('input, textarea')
          .evaluateAll((els, name) => els.some((el) => (el as HTMLInputElement).value === name), 'Yoke Carry Press'),
      )
      .toBe(false);
    // Delete is DELETE_SHARED_RESOURCE -- owner-only and unconditional, so no member ever gets it.
    await expect(dialog.getByRole('button', { name: 'Delete this exercise' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Their own, which nobody else has logged: theirs to rename, and still no delete.
    await backToPicker(page);
    await addOwnExercise(page, 'Sam Sled Push');
    await page.getByRole('button', { name: 'Customize this exercise' }).click();

    await expect(dialog).toContainText('Created by you');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete this exercise' })).toHaveCount(0);
  });

  // Everything behind Customize is a PER-PERSON write (standing note, tags, setup fields), so on a
  // sibling's screen all of it 403s. Its two neighbours in that action row were ReadOnlyWrapped and
  // this was not, which left a live button between two greyed ones opening a modal where nothing
  // could save.
  test('a member cannot open Customize on a sibling\'s screen', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await loginAs(page, member.email, member.password);

    // Their own screen: all three controls in the action row are live.
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Customize this exercise' })).toBeEnabled();

    // Switch to the sibling. Scoped to .app-chrome: the bare name also matches the account-menu
    // trigger, which is a strict-mode violation (see the first test in this file).
    await page.locator('.app-chrome').getByRole('button', { name: 'Nate', exact: true }).click();
    await page.getByRole('link', { name: 'Log' }).click();
    await pickExercise(page, 'Barbell Bench Press');

    await expect(page.getByRole('status').filter({ hasText: 'Viewing Nate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Customize this exercise' })).toBeDisabled();
    // Asserted alongside its neighbours so the three read as one row -- those two were already
    // wrapped, and the point is that this one now matches them.
    await expect(page.getByRole('button', { name: /favorites/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /note for this session/ })).toBeDisabled();
  });

  // The Team-tier seam. The product ships visibility forced ON with no endpoint and no UI, so
  // this profile-gated route is the only way to reach the OFF path -- which is what keeps it
  // exercised code rather than dead code waiting to rot.
  test('with household visibility off, a member sees only themselves', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');

    await addPerson(page, 'Sam');

    const member = await addMemberLogin(page, request, ownerEmail, 'Sam');
    await setMemberVisibility(request, ownerEmail, false);
    await loginAs(page, member.email, member.password);

    // One visible person means PersonPillBar hides itself -- no code change was needed for that,
    // because it already hides below two people and /me's list is filtered server-side.
    await expect(page.locator('.app-chrome').getByRole('button', { name: 'Nate', exact: true })).toHaveCount(0);
    // And their own screen is still fully live.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('button', { name: '+ Log a past workout' })).toBeEnabled();
  });
});
