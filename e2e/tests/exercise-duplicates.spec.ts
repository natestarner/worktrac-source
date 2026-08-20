import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise, addOwnTimedExercise, backToPicker, openExistingViaAddOwn } from './support/exercises';

// Adding an exercise that already exists used to create a second one, indistinguishable from the
// first: the picker, History, PRs, Trends and the routine strip all render a bare name. Now the
// modal spots it while you type and offers to open the one you have.
//
// Deliberately NOT a parity spec. The resolution reads whatever queryKeys.exercises() holds, by one
// code path in every mode -- what varies while degraded is the CONTENT of that cache, which is data
// rather than a branch. Its degraded behaviour (a stale cache misses a duplicate, and
// ExerciseService.add converges it on sync) is covered by ExerciseDuplicateCreateTest, where it can
// be asserted directly instead of inferred from the UI.

test.describe('duplicate exercises', () => {
  test('adding an exercise you already have opens it instead of creating a second', async ({ page, request }) => {
    await registerHousehold(page, request, 'Halloway');

    await addOwnExercise(page, 'Zercher Squat');
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();

    // Back to the picker, then try to add the very same exercise again.
    await backToPicker(page);
    await openExistingViaAddOwn(page, 'Zercher Squat');

    // Lands on the SAME exercise's detail screen -- not a second one, and not the picker.
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
    await expect(page.getByText('Zercher Squat', { exact: true })).toBeVisible();

    // And there is still exactly one of it in the picker. `exact` because the chip's whole text is
    // the name; a substring match would also hit a suffixed sibling.
    await backToPicker(page);
    await expect(page.getByRole('button', { name: 'Zercher Squat', exact: true })).toHaveCount(1);
  });

  test('says so before you commit, rather than after', async ({ page, request }) => {
    await registerHousehold(page, request, 'Halloway');
    await addOwnExercise(page, 'Zercher Squat');
    await backToPicker(page);

    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Zercher Squat');

    // The whole point of resolving during render: the button and the note change under their
    // finger, so nothing is a surprise once they tap.
    await expect(page.getByText('You already have this exercise.')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  });

  test('the same name with a different measure becomes its own exercise, named apart', async ({ page, request }) => {
    await registerHousehold(page, request, 'Halloway');

    await addOwnExercise(page, 'Ring Hold');
    await backToPicker(page);

    // Same name, measured in Time. A genuinely different exercise -- so it is created, but the name
    // is disambiguated rather than left to collide.
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Ring Hold');
    await page.getByRole('dialog').getByRole('button', { name: 'Time', exact: true }).click();
    await expect(page.getByText('You have a Ring Hold measured in Reps. This one saves as Ring Hold (Time).')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();

    // Opened on the suffixed exercise, and it is the timed one -- the second stepper is Time.
    await expect(page.getByText('Ring Hold (Time)', { exact: true })).toBeVisible();
    await expect(page.locator('.stepper-row').filter({ hasText: 'Time' })).toBeVisible();

    // Both live in the picker, and they are now told apart at a glance.
    await backToPicker(page);
    await expect(page.getByRole('button', { name: 'Ring Hold', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Ring Hold (Time)', exact: true })).toHaveCount(1);
  });

  test('a third attempt at an already-suffixed name opens it rather than suffixing twice', async ({ page, request }) => {
    await registerHousehold(page, request, 'Halloway');

    await addOwnExercise(page, 'Ring Hold');
    await backToPicker(page);
    await addOwnTimedExercise(page, 'Ring Hold');
    await expect(page.getByText('Ring Hold (Time)', { exact: true })).toBeVisible();
    await backToPicker(page);

    // Typing "Ring Hold" with Time selected again would suffix to "Ring Hold (Time)" -- which now
    // exists. Creating there would produce exactly the duplicate this feature prevents.
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Ring Hold');
    await page.getByRole('dialog').getByRole('button', { name: 'Time', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open Ring Hold (Time)', exact: true }).click();

    await expect(page.getByText('Ring Hold (Time)', { exact: true })).toBeVisible();
    await backToPicker(page);
    await expect(page.getByRole('button', { name: 'Ring Hold (Time)', exact: true })).toHaveCount(1);
  });

  test('a preloaded library exercise counts as one you already have', async ({ page, request }) => {
    await registerHousehold(page, request, 'Halloway');

    // The commonest real case: typing a name the seeded library already carries. Opening the global
    // row means sets land on the canonical exercise instead of a private fork of it -- and because
    // it also favorites it, it is in the picker afterwards exactly as a created one would be.
    await openExistingViaAddOwn(page, 'Barbell Bench Press');

    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
    await backToPicker(page);
    await expect(page.getByRole('button', { name: 'Barbell Bench Press', exact: true })).toHaveCount(1);
  });
});
