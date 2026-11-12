import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// Every password field has a show / hide eye (frontend/src/components/shared/PasswordInput.jsx).
// These pin what jsdom cannot: a real browser keeps the typed value across the type switch, keeps
// focus in the field when the eye is pressed, and still signs in with the password showing.

test.describe('show password', () => {
  test('on the login screen, the eye reveals the password, and signing in still works', async ({
    page,
    request,
    browser,
  }) => {
    const email = await registerHousehold(page, request, 'Riley');

    // A fresh, signed-out browser for the login screen.
    const context = await browser.newContext();
    const login = await context.newPage();
    await login.goto('/login');
    await login.getByPlaceholder('Email', { exact: true }).fill(email);
    const password = login.getByPlaceholder('Password', { exact: true });
    await password.fill('password123');
    await expect(password).toHaveAttribute('type', 'password');

    await login.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('password123');
    // Pressing the eye must not take focus out of the field (on a phone, that closes the keyboard).
    await expect(password).toBeFocused();

    await login.getByRole('button', { name: 'Log in' }).click();
    await expect(login).toHaveURL(/\/app\/log/);
    await context.close();
  });

  test('the sign-up screen has the eye too, and hiding again restores the dots', async ({ page }) => {
    await page.goto('/register');
    const password = page.getByPlaceholder('At least 8 characters');
    await password.fill('a-new-password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('a-new-password');
  });
});
