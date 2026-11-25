import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise } from './support/exercises';

// A household's OWN exercise: "Measured in" on Add exercise (Weight & reps, the default; Bodyweight;
// Time) decides how its first set asks for a weight, and Customize switches Weight & reps <->
// Bodyweight later. The library half and every connectivity mode are parity-first-set-weight.spec.ts.

test.describe('your own exercise\'s load type', () => {
  test('defaults to Weight & reps: the first set asks for a weight', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await addOwnExercise(page, 'Hip Thrust Machine');

    await expect(page.getByRole('button', { name: 'Enter a weight' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('');
  });

  test('chosen as Bodyweight, the first set starts at 0 under "Added"', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Ring Dip');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).last().click();

    await expect(page.getByRole('textbox', { name: 'Added (lb)' })).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();
  });

  test('can be switched to Bodyweight later in Customize', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await addOwnExercise(page, 'Ring Row');
    await expect(page.getByRole('button', { name: 'Enter a weight' })).toBeDisabled();

    // Customize is enabled once the create has synced (it needs a real id).
    const customize = page.getByRole('button', { name: 'Customize this exercise' });
    await expect(customize).toBeEnabled();
    await customize.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Weight & reps', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Bodyweight', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('textbox', { name: 'Added (lb)' })).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();

    // It stuck on the SERVER, which is what every other device reads. Asked directly rather than by
    // reloading: the catalog cache is written to the device at most once a second, so a reload in
    // that window shows the copy from before (the same accepted gap as a muscles edit).
    const { apiUrl } = await (await page.request.get('/config.json')).json();
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    await expect
      .poll(async () => {
        const rows = await (await page.request.get(`${apiUrl}/api/exercises`, {
          headers: { Authorization: `Bearer ${token}` },
        })).json();
        return rows.find((e: { name: string }) => e.name === 'Ring Row')?.loadType;
      })
      .toBe('bodyweight');
  });
});
