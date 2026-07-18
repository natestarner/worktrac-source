import { test, expect } from '@playwright/test';
import { registerHousehold, fetchPendingCode } from './support/auth';

test.describe('Password reset', () => {
  test('reset the password via the emailed code and log in with the new one', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Alex');

    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByRole('button', { name: 'Send reset code' }).click();
    await expect(page).toHaveURL(/\/reset-password/);

    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const code = await fetchPendingCode(request, apiUrl, email);

    await page.getByPlaceholder('123456').fill(code);
    await page.getByPlaceholder('At least 8 characters').fill('newpassword456');
    await page.getByRole('button', { name: 'Reset password' }).click();

    // No auto-login after a reset -- lands back on /login with a success banner instead.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Password reset -- sign in with your new password.')).toBeVisible();

    // The old password no longer works.
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/login/);

    // The new password does.
    await page.getByPlaceholder('Password').fill('newpassword456');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });

  // Non-enumeration: an unregistered email must reach the exact same code-entry screen as a
  // registered one -- the form gives no indication either way.
  test('requesting a reset for an unregistered email reaches the same code-entry screen', async ({ page }) => {
    const email = `e2e-unregistered-${Date.now()}@example.com`;

    await page.goto('/forgot-password');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByRole('button', { name: 'Send reset code' }).click();

    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.getByText(new RegExp(email))).toBeVisible();
  });
});
