import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

test.describe('Routines', () => {
  test('create a routine, start it, and step through to completion', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();

    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await page.getByRole('button', { name: '+ Barbell Bench Press' }).click();
    await page.getByRole('button', { name: '+ Dumbbell Overhead Press' }).click();
    await page.getByRole('button', { name: 'Save routine' }).click();

    await expect(page.getByText('Push Day')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press, Dumbbell Overhead Press')).toBeVisible();

    await page.getByRole('button', { name: 'Start workout' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await page.getByRole('button', { name: 'Next exercise' }).click();
    await expect(page.getByText('2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.getByText('Workout complete!')).toBeVisible();
  });
});
