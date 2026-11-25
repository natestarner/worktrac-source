import { test, expect } from '@playwright/test';
import { fetchPendingCode } from './support/auth';

// The emailed code is drawn as two groups ("123 456", verification-code.html), so a code copied out
// of an email can carry the gap -- or the sentence around it. The field had maxLength={6}, which the
// browser applies to a paste BEFORE the app strips non-digits: "123 456" landed as "12345", and
// "Your code is 123456" as nothing at all. Reported from TestFlight 1.4 (2026-11-25), where pasting
// the code was already awkward. insertText is what a paste delivers, maxLength and all.
test.describe('pasting the emailed code', () => {
  test('a code pasted with its gap confirms the account', async ({ page, request }) => {
    const email = `huddle+e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@starner.co`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Jordan');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);

    const { apiUrl } = await (await request.get('/config.json')).json();
    const code = await fetchPendingCode(request, apiUrl, email);

    const field = page.getByPlaceholder('123456');
    await field.focus();
    await page.keyboard.insertText(`${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(field).toHaveValue(code);

    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });

  test('a code pasted inside its sentence keeps just the code', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByPlaceholder('you@example.com').fill(`huddle+e2e-nobody-${Date.now()}@starner.co`);
    await page.getByRole('button', { name: 'Send reset code' }).click();
    const field = page.getByPlaceholder('123456');
    await field.focus();
    await page.keyboard.insertText('Your code is 482 913');
    await expect(field).toHaveValue('482913');
  });

  // "Paste code" reads the clipboard itself, so pasting never depends on iOS's edit menu, which the
  // App Store app's confirm screen did not show (TestFlight 1.4). Chromium only: it is the engine
  // Playwright can grant clipboard access to.
  test('"Paste code" fills the box from the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/forgot-password');
    await page.getByPlaceholder('you@example.com').fill(`huddle+e2e-nobody-${Date.now()}@starner.co`);
    await page.getByRole('button', { name: 'Send reset code' }).click();
    await page.evaluate(() => navigator.clipboard.writeText('Your code is 482 913'));

    await page.getByRole('button', { name: 'Paste code' }).click();
    await expect(page.getByPlaceholder('123456')).toHaveValue('482913');
  });
});
