import { expect, test, type Page } from '@playwright/test';
import { loginAs, registerHousehold } from './support/auth';
import {
  installTestIdentityProvider,
  newTestIdentity,
  testProviderConfigured,
  type TestIdentity,
} from './support/socialSignIn';

// Sign in with Apple / Google, end to end, with the backend's test identity provider standing in
// for both (support/socialSignIn.ts). docs/architecture/social-sign-in.md has the rules.
//
// Not @critical: lower must first carry `socialSignIn.test` in its frontend config and the backend
// flag (worktrac-deploy). Where it does not, this skips with that reason rather than failing.

async function openProfile(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
}

// Profile's Danger zone row reads "Delete account" beside a button named just "Delete".
async function openDeleteAccount(page: Page) {
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete your account?' })).toBeVisible();
}

async function logout(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

const PROVIDER_BUTTON = 'Continue with Test provider';

test.describe('sign in with Apple or Google', () => {
  let identity: { current: TestIdentity };

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await testProviderConfigured(request)),
      'This environment does not offer the test identity provider (config.json socialSignIn.test).');
    identity = { current: newTestIdentity() };
    await installTestIdentityProvider(page, request, identity);
  });

  test('a new person signs up with the provider, then signs back in as the same login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();

    // New: the password form steps aside and the name step asks one thing.
    await expect(page.getByPlaceholder('Password', { exact: true })).toBeHidden();
    await page.getByLabel('Your name').fill('Riley');
    await page.getByRole('button', { name: 'Create my household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    // A brand-new household gets the first-run welcome, as a password registration does.
    await page.getByRole('button', { name: 'Not now' }).click();

    await logout(page);
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    // Signed back in to the same household: Riley is still the person on screen.
    await expect(page.getByText('Riley').first()).toBeVisible();
  });

  // ⚠️ The account-takeover guard, through the real screens: a provider identity carrying the
  // email of an existing password login is refused and pointed at the password, never linked.
  test('an email that already has a password login is sent to its password', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Morgan');
    await logout(page);
    identity.current = { ...newTestIdentity(), email };

    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();

    await expect(page.getByRole('alert')).toContainText('Sign in with your password');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Your name')).toBeHidden();
  });

  test('a password login connects the provider, signs in with it, and disconnects it', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Casey');
    await openProfile(page);
    await page.getByRole('button', { name: 'Connect Test provider' }).click();
    await expect(page.getByText('Test provider connected.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect Test provider' })).toBeVisible();

    await logout(page);
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await openProfile(page);
    await page.getByRole('button', { name: 'Disconnect Test provider' }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    // A replacement session: still signed in, and offered the provider to connect again.
    await expect(page.getByRole('button', { name: 'Connect Test provider' })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/profile/);

    // The password still works.
    await logout(page);
    await loginAs(page, email, 'password123');
  });

  test('a provider-only login sets a first password, confirming with the provider', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await page.getByLabel('Your name').fill('Jordan');
    await page.getByRole('button', { name: 'Create my household' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();

    await openProfile(page);
    await expect(page.getByText('No password yet')).toBeVisible();
    await page.getByRole('button', { name: 'Set a password' }).click();
    await page.getByLabel('New password', { exact: true }).fill('jordans-password');
    await page.getByLabel('Confirm new password').fill('jordans-password');
    await page.getByRole('button', { name: 'Confirm with Test provider' }).click();
    await expect(page.getByText('Password set.', { exact: false })).toBeVisible();

    await logout(page);
    await loginAs(page, identity.current.email!, 'jordans-password');
  });

  test('a provider-only login deletes its account by confirming with the provider', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await page.getByLabel('Your name').fill('Avery');
    await page.getByRole('button', { name: 'Create my household' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();

    await openProfile(page);
    await openDeleteAccount(page);
    await expect(page.getByPlaceholder('Your password')).toBeHidden();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await page.getByRole('button', { name: 'Delete and confirm with Test provider' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Gone: the same identity is a new person again.
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
  });
});

// The bug fixed alongside this feature: a wrong password in Delete account used to sign the person
// out (the server answered 401, which the app reads as "session expired"). It now says so and
// leaves them where they were. Runs everywhere -- it needs no provider.
test('a wrong password in Delete account keeps you signed in and says why', async ({ page, request }) => {
  await registerHousehold(page, request, 'Quinn');
  await openProfile(page);
  await openDeleteAccount(page);
  await page.getByPlaceholder('DELETE').fill('DELETE');
  await page.getByPlaceholder('Your password').fill('not-my-password');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();

  await expect(page.getByText('That password is not correct.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/profile/);
  await page.reload();
  await expect(page).toHaveURL(/\/app\/profile/);
});
