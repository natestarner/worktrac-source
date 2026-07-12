import { test, expect } from '@playwright/test';

async function registerHousehold(page, personName: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto('/register');
  await page.getByPlaceholder('e.g. Alex').fill(personName);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page).toHaveURL(/\/app\/log/);
}

test.describe('Routines', () => {
  test('create a routine, start it, and step through to completion', async ({ page }) => {
    await registerHousehold(page, 'Jordan');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();

    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await page.getByRole('button', { name: '+ Barbell Bench Press' }).click();
    await page.getByRole('button', { name: '+ Dumbbell Overhead Press' }).click();
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
});
