import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

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

test.describe('App Settings', () => {
  test('add a category, add a custom exercise, add and remove a person, switch units', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');
    await openAppSettings(page);

    // Add a category first so the new exercise can use it.
    await page.getByPlaceholder('New category name').fill('Conditioning');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Conditioning')).toBeVisible();

    // Add a custom exercise using that category.
    await page.getByRole('button', { name: '+ Add exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Sled Push');
    await page.getByRole('button', { name: 'Conditioning' }).click();
    // The modal has two "Add" buttons (add-setup-field-chip, then submit) -- the
    // submit button is the last one in DOM order.
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Sled Push')).toBeVisible();

    // Add a second person from the pill bar, then remove them from Profile.
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: /Sam/ })).toBeVisible();

    await openProfile(page);
    await page.getByRole('button', { name: 'Remove' }).click();
    // The exercise library also has a "Delete" link underneath the confirm overlay --
    // scope to the confirm dialog specifically.
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: /Sam/ })).toHaveCount(0);

    // Switch default unit to kg.
    await openAppSettings(page);
    await page.getByRole('button', { name: 'kg', exact: true }).click();
    await expect(page.getByText(/Default unit for new sets/)).toBeVisible();
  });

  test('exercise, category, and person deletions show the right confirmation wording', async ({ page, request }) => {
    await registerHousehold(page, request, 'Riley');
    await openAppSettings(page);

    // A private (account-owned) exercise's delete confirm text differs from a global one's.
    await page.getByRole('button', { name: '+ Add exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Sled Push');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Sled Push')).toBeVisible();

    await rowWithButton(page, 'Sled Push', 'Delete').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('Already-logged sets for it are kept, but it will disappear from the picker.');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // A global (system) exercise's delete confirm text warns it only affects this household.
    await rowWithButton(page, 'Barbell Bench Press', 'Delete').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('other households keep it');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Category delete confirm text.
    await page.getByPlaceholder('New category name').fill('Mobility');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Mobility')).toBeVisible();
    await rowWithButton(page, 'Mobility', '×').getByRole('button', { name: '×', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Delete category "Mobility"?');
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

  test('adding a setup field in App Settings lets each person set their own value for it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Morgan');
    await openAppSettings(page);

    // Add a custom exercise with a setup field defined for it. Pick a category
    // explicitly rather than relying on the modal's default selection, which is only
    // reliable once the categories list has finished loading.
    await page.getByRole('button', { name: '+ Add exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Cable Row');
    await page.getByRole('dialog').getByRole('button', { name: 'Upper Pull' }).click();
    await page.getByPlaceholder('Field name').fill('Seat position');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(page.getByRole('dialog').getByText('Seat position')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Cable Row')).toBeVisible();

    // On the Log tab, the field shows as an inline "Tap to set" pill next to the
    // exercise name -- setting a value there is per-person, not shared.
    await page.getByRole('link', { name: 'Log' }).click();
    await page.getByRole('button', { name: 'Cable Row' }).click();
    await page.getByRole('button', { name: /Seat position: set/ }).click();
    await page.getByPlaceholder('e.g. 5').fill('7');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Seat position: 7' })).toBeVisible();

    // Removing the field name in App Settings removes it from the exercise's setup fields.
    await openAppSettings(page);
    await rowWithButton(page, 'Cable Row', 'Edit').getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByText('Seat position').getByRole('button', { name: '×', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    // Navigating back to Log resumes showing Cable Row's detail directly (the selected
    // exercise persists across tab switches), so there's no picker button to click here.
    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page.getByText('Cable Row')).toBeVisible();
    await expect(page.getByRole('button', { name: /Seat position/ })).toHaveCount(0);
  });
});
