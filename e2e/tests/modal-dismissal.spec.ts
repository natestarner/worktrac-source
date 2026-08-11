import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine } from './support/exercises';

// A modal never closes on a backdrop tap. This app is used one-handed on an iPad mid-set, where a
// stray thumb on the scrim used to discard a half-built routine or an unsaved note with no
// confirmation and no undo. Closing is always deliberate now: the header X, a footer button, or
// Escape.
//
// Covered here rather than only in Modal.test.jsx because the thing that regressed in the unit
// test's absence would be a call site quietly reinstating a click handler on the scrim, and
// because the scrim is a real portal element with real pointer-event behaviour.
test.describe('Modal dismissal', () => {
  // The scrim is the dialog's own parent -- the fixed, full-viewport overlay it is centred in.
  // Clicking at position 4,4 lands in its top-left corner, well clear of any dialog.
  async function clickOutside(page) {
    await page.getByRole('dialog').locator('..').click({ position: { x: 4, y: 4 } });
  }

  test('clicking outside a modal leaves it open, and the X closes it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Emerson');

    await page.getByRole('button', { name: '+ Add person' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await clickOutside(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('Escape still closes a modal', async ({ page, request }) => {
    await registerHousehold(page, request, 'Flynn');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The one keyboard exit from a focus-trapped dialog -- removing it along with the backdrop
    // would leave a keyboard user with no way out at all.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('a half-built routine survives a stray tap outside the modal', async ({ page, request }) => {
    // The failure this exists for, in the shape it actually took: several minutes of picking
    // exercises, one mis-tap, everything gone.
    await registerHousehold(page, request, 'Gray');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Leg Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');

    await clickOutside(page);

    await expect(page.getByPlaceholder('Routine name (e.g. Push Day)')).toHaveValue('Leg Day');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await expect(page.getByText('Leg Day', { exact: true })).toBeVisible();
  });
});
