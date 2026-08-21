import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { goHardOffline, goOnline } from './support/offline';

// The admin side of this feature (reading submissions in the portal) is deliberately NOT covered
// here, for the same reason admin-portal.spec.ts gives: reaching the portal needs the real, fixed
// ADMIN_EMAILS address, which can only be registered once per environment, so there is no
// repeatable CI-safe way to drive it. That half is covered at the backend integration level by
// ContactControllerTest and AdminAuthorizationTest instead.

async function openContact(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Contact Us' }).click();
  await expect(page).toHaveURL(/\/app\/contact/);
}

test.describe('Contact Us', () => {
  test('reaches the form from the profile dropdown, above Logout', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlowe');

    await page.locator('.header-bar').getByRole('button').click();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items).toContain('Contact Us');
    expect(items.indexOf('Contact Us')).toBeLessThan(items.indexOf('Logout'));

    await page.getByRole('menuitem', { name: 'Contact Us' }).click();
    await expect(page).toHaveURL(/\/app\/contact/);
    await expect(page.getByLabel('Subject')).toBeVisible();
    await expect(page.getByLabel('Details')).toBeVisible();
  });

  test('sends a bug report and confirms it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Okonkwo');
    await openContact(page);

    await page.getByRole('button', { name: 'Bug', exact: true }).click();
    await page.getByLabel('Subject').fill('Rest timer resets on tab switch');
    await page.getByLabel('Details').fill('The rest timer goes back to zero whenever I switch tabs.');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Message sent', { exact: true })).toBeVisible();
    // The form is gone, so a second tap can't resend by accident.
    await expect(page.getByLabel('Details')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send another' })).toBeVisible();
  });

  test('refuses to send an empty or too-short report', async ({ page, request }) => {
    await registerHousehold(page, request, 'Bettencourt');
    await openContact(page);

    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Add a short subject.', { exact: true })).toBeVisible();

    await page.getByLabel('Subject').fill('Something');
    await page.getByLabel('Details').fill('too short');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(/at least 10 characters/)).toBeVisible();
  });

  // The disclosure is what keeps the auto-attached diagnostics from being covert.
  test('shows what gets sent alongside the message', async ({ page, request }) => {
    await registerHousehold(page, request, 'Vasquez');
    await openContact(page);

    await page.getByRole('button', { name: /What gets sent with this/ }).click();
    await expect(page.getByText('Screen you came from', { exact: true })).toBeVisible();
    await expect(page.getByText('Connection', { exact: true })).toBeVisible();
    await expect(page.getByText('App version', { exact: true })).toBeVisible();
  });

  // A gated write has no outbox behind it, so the control is disabled UP FRONT rather than letting
  // someone type a whole report and only then discover it can't go.
  test('greys out sending while offline and re-arms on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Adeyemi');
    await openContact(page);

    await goHardOffline(page);
    const send = page.getByRole('button', { name: 'Send message' });
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', /needs a connection/i);

    await goOnline(page);
    await expect(send).toBeEnabled();
  });

  // The reason the gate is acceptable rather than lossy: nothing typed is ever thrown away by it.
  test('keeps a draft written offline, and sends it once back online', async ({ page, request }) => {
    await registerHousehold(page, request, 'Lindqvist');
    await openContact(page);

    await goHardOffline(page);
    await page.getByLabel('Subject').fill('Written while offline');
    await page.getByLabel('Details').fill('I typed this whole thing with no connection at all.');

    // Leave the page entirely and come back -- the draft is per-person persisted state, not
    // component state.
    await page.getByRole('button', { name: '← Back' }).click();
    await openContact(page);
    await expect(page.getByLabel('Subject')).toHaveValue('Written while offline');

    await goOnline(page);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Message sent', { exact: true })).toBeVisible();
  });

  test('a draft survives a reload', async ({ page, request }) => {
    await registerHousehold(page, request, 'Castellanos');
    await openContact(page);

    await page.getByLabel('Subject').fill('Survives a reload');
    await page.getByLabel('Details').fill('This text must still be here after the page reloads.');

    await page.reload();
    await expect(page).toHaveURL(/\/app\/contact/);
    await expect(page.getByLabel('Subject')).toHaveValue('Survives a reload');
    await expect(page.getByLabel('Details')).toHaveValue('This text must still be here after the page reloads.');
  });

  // Sending clears the draft, so the next report starts from a blank form rather than the last one.
  test('starts blank after a successful send', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nakashima');
    await openContact(page);

    await page.getByLabel('Subject').fill('First report');
    await page.getByLabel('Details').fill('The first report I ever sent through this form.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Message sent', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Send another' }).click();
    await expect(page.getByLabel('Subject')).toHaveValue('');
    await expect(page.getByLabel('Details')).toHaveValue('');
  });
});
