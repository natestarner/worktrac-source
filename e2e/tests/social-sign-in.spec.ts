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

  // Between the provider's sheet closing and the app appearing, the login screen used to sit there
  // looking idle. The overlay covers exactly that wait -- our own sign-in request -- so each request
  // is HELD here until the spec releases it, with no timing guess either way.
  test('a "Signing you in" screen covers the wait, through the name step and into the app', async ({ page }) => {
    const held: Array<() => void> = [];
    await page.route('**/api/auth/oauth/**', async (route) => {
      await new Promise<void>((release) => held.push(release));
      await route.continue();
    });
    const overlay = page.getByTestId('signing-in-overlay');

    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(overlay).toContainText('Signing you in…');
    await expect.poll(() => held.length).toBe(1);
    held[0]();

    // A new identity: the name step replaces it, usable.
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(overlay).toBeHidden();
    await page.getByLabel('Your name').fill('Jordan');
    await page.getByRole('button', { name: 'Create my household' }).click();
    await expect(overlay).toContainText('Creating your household…');
    await expect.poll(() => held.length).toBe(2);
    held[1]();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(overlay).toBeHidden();
  });

  // A server that never answers: the request's own 45s limit (AUTH_TIMEOUT_MS) ends the attempt,
  // and the overlay comes down with it, before "Start over" is ever needed.
  test('a sign-in the server never answers ends at its time limit and says why', async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/auth/oauth/**', () => {}); // never fulfilled
    const overlay = page.getByTestId('signing-in-overlay');

    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(overlay).toBeVisible();

    await page.clock.fastForward(45_000);
    await expect(overlay).toBeHidden();
    await expect(page.getByRole('alert')).toContainText('reach Huddle');
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toBeEnabled();
  });

  // ⚠️ The worst case: something under the attempt hangs where no time limit reaches (a response
  // body that stalls after its headers, an IndexedDB that never answers). Stood in for here by a
  // fetch that never settles and ignores its abort. The overlay offers its own way out, and the
  // screen behind must then work in full -- the very button whose attempt is still hanging included.
  test('a sign-in stuck past every time limit can be abandoned, and the next one works', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      (window as unknown as { __stuckSignIn: boolean }).__stuckSignIn = true;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/auth/oauth/') && (window as unknown as { __stuckSignIn: boolean }).__stuckSignIn) {
          return new Promise(() => {});
        }
        return realFetch(input, init);
      };
    });
    const overlay = page.getByTestId('signing-in-overlay');

    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(overlay).toBeVisible();

    // Step the clock until "Start over" shows. Not one 60s jump: the overlay's timers start in an
    // effect a moment AFTER it is on screen, and a jump the instant it appears can land before they
    // exist (it did, in WebKit). The exact 60s boundary is pinned by the unit tests' fake timers;
    // what only a browser can show is that the way out appears and works.
    const startOver = page.getByRole('button', { name: 'Start over' });
    await expect.poll(async () => {
      await page.clock.fastForward(5_000);
      return startOver.isVisible();
    }).toBe(true);
    await startOver.click();

    await expect(overlay).toBeHidden();
    await expect(page.getByRole('alert')).toContainText('taking longer than it should');

    await page.evaluate(() => { (window as unknown as { __stuckSignIn: boolean }).__stuckSignIn = false; });
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(overlay).toBeHidden();
  });

  test('when the sign-in fails, the screen comes back with the reason and the buttons work', async ({ page }) => {
    const held: Array<() => void> = [];
    await page.route('**/api/auth/oauth/**', async (route) => {
      await new Promise<void>((release) => held.push(release));
      await route.fulfill({ status: 503, json: { message: 'Huddle is having trouble right now. Try again in a moment.' } });
    });
    const overlay = page.getByTestId('signing-in-overlay');

    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(overlay).toBeVisible();
    await expect.poll(() => held.length).toBe(1);
    held[0]();

    await expect(overlay).toBeHidden();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toBeEnabled();
  });

  // A new account can be created from the LOG IN page (the name step), which shows no Terms of its
  // own. The agreement sits under the button that creates it, and the links work.
  test('a sign-up that starts on Log in shows the Terms beside the button that creates the account', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();

    await expect(page.getByText('By creating your household, you agree to our', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', 'https://huddle.fitness/terms.html');
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', 'https://huddle.fitness/privacy.html');
  });

  // Register already has its own line under both ways in; during the name step only one may show.
  test('Register shows one agreement during the name step, not two', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(/you agree to our/)).toHaveCount(1);
    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    // Not "Your name": Register's own password form has a field by that name, so waiting on it
    // passes before the name step exists (that made this test vacuous on its first run).
    await expect(page.getByRole('heading', { name: 'Welcome to Huddle' })).toBeVisible();
    await expect(page.getByText(/you agree to our/)).toHaveCount(1);
    await expect(page.getByText('By creating your household, you agree to our', { exact: false })).toBeVisible();
  });

  // An Apple "Hide My Email" relay address matches nothing else, so tapping the OTHER provider next
  // time makes a second, empty household. "Last used" points back at the right button, and a
  // password sign-in takes the mark away.
  test('the provider this device signed in with last is named under its button, until a password sign-in', async ({ page, request }) => {
    const caption = page.getByTestId('provider-last-used');
    const lastUsed = 'You last signed in with Test provider';

    await page.goto('/login');
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toBeVisible();
    await expect(caption).toHaveCount(0);

    await page.getByRole('button', { name: PROVIDER_BUTTON }).click();
    // The name step asks first whether this person already has a household (nothing is created
    // until they submit). This device remembers no other way in, so it says "a different way".
    await expect(page.getByTestId('existing-household-hint')).toContainText(
      'Already have a household? You may have signed up a different way.',
    );
    await page.getByLabel('Your name').fill('Avery');
    await page.getByRole('button', { name: 'Create my household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await page.getByRole('button', { name: 'Not now' }).click();
    await logout(page);

    // The caption is under the button the person used, and the button keeps its name.
    await expect(caption).toHaveText(lastUsed);
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toHaveAccessibleDescription(lastUsed);
    const button = await page.getByRole('button', { name: PROVIDER_BUTTON }).boundingBox();
    const under = await caption.boundingBox();
    expect(under!.y).toBeGreaterThanOrEqual(button!.y + button!.height);

    // Forgot password: this device has used the provider and never a password, so it points back.
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByTestId('forgot-password-provider-hint')).toContainText(
      'Signed up with Test provider? This device has signed in with Test provider before.',
    );
    await page.getByRole('link', { name: 'Log in screen' }).click();
    await expect(page).toHaveURL(/\/login/);

    // A password sign-in on this device (a password registration here) replaces it.
    await registerHousehold(page, request, 'Blake');
    await logout(page);
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toBeVisible();
    await expect(caption).toHaveCount(0);

    // ...and now this device has used a password too, Forgot password points nowhere.
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByTestId('forgot-password-provider-hint')).toHaveCount(0);
  });

  // A new device knows nothing, and an Apple "Hide My Email" account is under a relay address, so
  // the email typed into Forgot password matches nothing and no code comes. The code screen says
  // why, to everyone, whatever email was typed.
  test('a device that knows nothing still learns why no reset code may come', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByTestId('forgot-password-provider-hint')).toHaveCount(0);
    await page.getByPlaceholder('you@example.com').fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Send reset code' }).click();

    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.getByTestId('reset-no-code-provider-hint')).toContainText(
      'No code? If you signed up with Test provider, your account has no password to reset',
    );
    await page.getByRole('link', { name: 'Log in screen' }).click();
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toBeVisible();
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
