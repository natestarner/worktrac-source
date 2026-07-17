import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine } from './support/exercises';

// The header's account-holder dropdown trigger shows the primary person's name too, so
// an unscoped getByRole('button', { name: /Name/ }) can match both it and that person's
// pill here -- scope to .person-pill-bar (the pill row's own container) to disambiguate.
function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

test.describe('Routines', () => {
  test('create a routine, start it, and step through to completion', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();

    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');

    // iOS Safari auto-zooms the page on focus for any input under 16px font-size -- lock
    // this in so a future style tweak can't reintroduce that.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveCSS('font-size', '16px');

    await addExerciseToRoutine(page, 'Barbell Bench Press');

    // Adding an exercise clears the search box, so it's ready for the next search
    // instead of still showing the previous term.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('');

    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    await page.getByRole('button', { name: 'Save routine' }).click();

    await expect(page.getByText('Push Day')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press, Dumbbell Overhead Press')).toBeVisible();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await page.getByRole('button', { name: 'Next exercise' }).click();
    await expect(page.getByText('2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Finish routine' }).click();
    await expect(page.getByText('Routine complete!')).toBeVisible();
  });

  test('copy a routine to another person and it appears independently in their routine list', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await personPill(page, 'Jordan').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Copy to…' }).click();
    await page.getByRole('checkbox', { name: 'Sam' }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByText(/Copied.*Sam/)).toBeVisible();

    await personPill(page, 'Sam').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    // Independence: deleting Jordan's original doesn't touch Sam's copy.
    await personPill(page, 'Jordan').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    // exact: true -- a plain substring match also catches the still-fading toast
    // ("Copied "Push Day" to Sam") and the confirm dialog's own message
    // ("Delete "Push Day"? ..."), both of which legitimately contain this text.
    await expect(page.getByText('Push Day', { exact: true })).not.toBeVisible();

    await personPill(page, 'Sam').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();
  });
});
