import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise, pickExercise } from './support/exercises';

// App Settings and Profile are both reached via the account-holder dropdown in the
// header, not a tab -- scope to .header-bar (the only button living there) rather than
// matching on the primary account holder's name, which varies per test.
async function openAppSettings(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'App Settings' }).click();
}

// People management (edit/remove) lives on Profile, not App Settings.
async function openProfile(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
}

// Styles are all inline in this app (no stable CSS classes), so the most reliable way
// to scope an action to one row among several near-identical rows is: the deepest
// element whose text includes the target string AND that also contains the button
// we're about to click -- ancestors of that row match both conditions too, so take the
// last (innermost) match in document order.
function rowWithButton(page, text: string, buttonName: string) {
  return page
    .locator('div')
    .filter({ hasText: text })
    .filter({ has: page.getByRole('button', { name: buttonName, exact: true }) })
    .last();
}

// Exercises are managed on the exercise screen now (create via the Log picker's "+ Add your
// own exercise"; rename/delete/setup-fields via the gear "Customize this exercise" modal).
// App Settings only keeps units, the household's shared tag manager, and data export.
test.describe('App Settings', () => {
  test('add a tag, create a custom exercise, add and remove a person, switch units', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    // Custom exercises are created from the Log picker now, not App Settings.
    await addOwnExercise(page, 'Sled Push');
    await expect(page.getByText('Sled Push')).toBeVisible();

    await openAppSettings(page);

    // Tags are managed here.
    await page.getByPlaceholder('New tag name').fill('Conditioning');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Conditioning')).toBeVisible();

    // Add a second person from the pill bar, then remove them from Profile.
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: /Sam/ })).toBeVisible();

    await openProfile(page);
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: /Sam/ })).toHaveCount(0);

    // Switch default unit to kg.
    await openAppSettings(page);
    await page.getByRole('button', { name: 'kg', exact: true }).click();
    await expect(page.getByText(/Default unit for new sets/)).toBeVisible();
  });

  test('deletions show the right confirmation wording', async ({ page, request }) => {
    await registerHousehold(page, request, 'Riley');

    // Your own exercise: delete lives in its Customize modal, and the confirm keeps logged sets.
    await addOwnExercise(page, 'Sled Push');
    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    await expect(page.getByRole('dialog').getByText('Created by you')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete this exercise' }).click();
    await expect(page.getByRole('dialog')).toContainText('Already-logged sets for it are kept, but it will disappear from your picker.');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // A preloaded (system) exercise is immutable: its Customize modal is badged as preloaded
    // and offers no delete.
    await page.getByRole('button', { name: /All exercises/ }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    await expect(page.getByRole('dialog').getByText('Preloaded exercise')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete this exercise' })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    // Tag delete confirm text (App Settings).
    await openAppSettings(page);
    await page.getByPlaceholder('New tag name').fill('Mobility');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Mobility')).toBeVisible();
    await rowWithButton(page, 'Mobility', '×').getByRole('button', { name: '×', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Delete tag "Mobility"?');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Mobility')).toHaveCount(0);

    // Person removal confirm text is explicit about what the cascade deletes.
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await openProfile(page);
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('dialog')).toContainText('Remove Sam? This deletes all of their sessions, sets, routines, and setup values.');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: /Sam/ })).toHaveCount(0);
  });

  test('a custom setup field lets each person set their own value for it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Morgan');

    // Add a custom setup field to an exercise via its Customize modal.
    await addOwnExercise(page, 'Cable Row');
    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    await page.getByPlaceholder('Add a field (e.g. seat height)').fill('Seat position');
    // The dialog now has two "Add" buttons (tags + setup fields), so submit via the field
    // input's Enter handler rather than an ambiguous button click.
    await page.getByPlaceholder('Add a field (e.g. seat height)').press('Enter');
    // The added field appears as a row with a "Remove Seat position" control.
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Remove Seat position' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    // The field shows as a per-person "Seat position: set" pill on the detail screen.
    await page.getByRole('button', { name: /Seat position: set/ }).click();
    await page.getByPlaceholder('e.g. 5').fill('7');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Seat position: 7' })).toBeVisible();

    // Removing the field via Customize removes its pill from the exercise.
    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove Seat position' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: /Seat position/ })).toHaveCount(0);
  });
});
