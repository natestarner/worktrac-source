import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine, pickExercise } from './support/exercises';

// The pill's live-session dot has no test id -- it's the second <span> child of the pill
// button (the first is always the initials avatar), so its presence/absence is a structural
// count rather than a label match.
function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

// Regression coverage for two of the originally-reported multi-person bugs: an active routine
// used to be forgotten on reload (state lived only in an in-memory reducer), and the person
// pill's "session in progress" dot used to only ever reflect whatever was true at page load
// (each pill fetched its own live-session state once and never refreshed it independently of
// the Log tab's own banner). Both are now backed by shared, persisted/cached state.
test.describe('State survives reload and stays live without a full reload', () => {
  test('an active routine survives a page reload, resuming at the same position', async ({ page, request }) => {
    await registerHousehold(page, request, 'Drew');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    await page.getByRole('button', { name: 'Save routine' }).click();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 2')).toBeVisible();

    // Advance one exercise in before reloading, so we're confirming the routine's ACTUAL
    // position survives, not just that a routine happens to be active.
    await page.getByRole('button', { name: 'Dumbbell Overhead Press' }).click();
    await expect(page.getByText('2 of 2')).toBeVisible();

    await page.reload();

    // Still in the routine, at the same position, on the Log tab -- not reset to the picker.
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish routine' })).toBeVisible();
  });

  test("a person's live-session dot appears and clears without a full page reload", async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Neither person has a live session yet -- no dot on either pill.
    await expect(personPill(page, 'Alex').locator('span')).toHaveCount(1);
    await expect(personPill(page, 'Sam').locator('span')).toHaveCount(1);

    // Alex logs a set -- starts Alex's live session. The dot must appear on Alex's own pill
    // right away, without a reload, and Sam's pill must stay dot-less.
    await personPill(page, 'Alex').click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await expect(personPill(page, 'Alex').locator('span')).toHaveCount(2);
    await expect(personPill(page, 'Sam').locator('span')).toHaveCount(1);

    // Ending the workout must clear the dot immediately too -- not just on next reload.
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    await expect(personPill(page, 'Alex').locator('span')).toHaveCount(1);
  });
});
