import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// Following a routine doesn't lock you into it: you can back out to the exercise picker,
// log something not on the routine, and then resume the routine at the same position --
// it never restarts from exercise #1 just because you stepped away from it.
test.describe('Routine interrupted by off-routine logging', () => {
  test('backing out to log an unrelated exercise preserves routine position for resuming', async ({ page, request }) => {
    await registerHousehold(page, request, 'Drew');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await page.getByRole('button', { name: '+ Barbell Bench Press' }).click();
    await page.getByRole('button', { name: '+ Dumbbell Overhead Press' }).click();
    await page.getByRole('button', { name: 'Save routine' }).click();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Back out to the picker -- routine position must survive being on the picker screen.
    await page.getByRole('button', { name: /All exercises/ }).click();
    await expect(page.getByText('1 of 2')).toBeVisible();

    // Log a set for an exercise that isn't part of the routine at all.
    await page.getByRole('button', { name: 'Barbell Back Squat' }).click();
    await expect(page.getByText('1 of 2')).toBeVisible(); // routine banner still shows, unmoved
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();

    // Resume the routine by jumping to its second exercise via the progress chips --
    // it should not have reset back to the first exercise because of the detour.
    await page.getByRole('button', { name: 'Dumbbell Overhead Press' }).click();
    await expect(page.getByText('2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Finish routine' }).click();
    await expect(page.getByText('Routine complete!')).toBeVisible();
  });
});
