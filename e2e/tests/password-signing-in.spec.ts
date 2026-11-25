import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fetchPendingCode, registerHousehold } from './support/auth';

// A password sign-in, and the Confirm that finishes a password registration, get the same
// full-screen overlay as Apple / Google (frontend/src/components/auth/SigningInOverlay.jsx): the
// same words, the same minimum time on screen, and the same way out. social-sign-in.spec.ts covers
// the Apple / Google side; this file is the password side, through the real screens.
//
// Each request is HELD by the spec until it releases it, so "the overlay covers the wait" is
// asserted with no timing guess either way.

const PASSWORD = 'password123';

async function logout(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function fillLogin(page: Page, email: string, password: string) {
  await page.getByPlaceholder('Email', { exact: true }).fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
}

function holdRequests(page: Page, pattern: string) {
  const held: Array<() => void> = [];
  return {
    held,
    install: () => page.route(pattern, async (route) => {
      await new Promise<void>((release) => held.push(release));
      await route.continue();
    }),
  };
}

test.describe('the "Signing you in" overlay on a password sign-in', () => {
  test('covers the wait from Log in until the app appears', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Parker');
    await logout(page);
    const login = holdRequests(page, '**/api/auth/login');
    await login.install();
    const overlay = page.getByTestId('signing-in-overlay');

    await fillLogin(page, email, PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(overlay).toContainText('Signing you in…');
    await expect.poll(() => login.held.length).toBe(1);
    // Still on the sign-in screen, covered, while the server has not answered.
    await expect(page).toHaveURL(/\/login/);
    login.held[0]();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(overlay).toBeHidden();
    await expect(page.getByText('Parker').first()).toBeVisible();
  });

  test('a wrong password comes back to the form with the reason, and the next try works', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Quinn');
    await logout(page);
    const overlay = page.getByTestId('signing-in-overlay');

    await fillLogin(page, email, 'not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(overlay).toBeHidden();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();

    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });

  // ⚠️ The worst case: something under the attempt hangs where no time limit reaches. Stood in for
  // by a fetch that never settles and ignores its abort, as in social-sign-in.spec.ts. The overlay
  // must offer its own way out, and the form must then work in full.
  test('a sign-in stuck past every time limit can be abandoned, and the next one works', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Rowan');
    await logout(page);
    // Installed before a fresh load of the page, like social-sign-in.spec.ts, so the fake clock and
    // the stuck fetch are in place from the document's first script.
    await page.clock.install();
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      (window as unknown as { __stuckLogin: boolean }).__stuckLogin = true;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/auth/login') && (window as unknown as { __stuckLogin: boolean }).__stuckLogin) {
          return new Promise(() => {});
        }
        return realFetch(input, init);
      };
    });
    const overlay = page.getByTestId('signing-in-overlay');

    await page.goto('/login');
    await fillLogin(page, email, PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(overlay).toBeVisible();

    // Step the clock until "Start over" shows (not one 60s jump: the overlay's timers start in an
    // effect a moment after it is on screen -- see social-sign-in.spec.ts).
    const startOver = page.getByRole('button', { name: 'Start over' });
    await expect.poll(async () => {
      await page.clock.fastForward(5_000);
      return startOver.isVisible();
    }).toBe(true);
    await startOver.click();

    await expect(overlay).toBeHidden();
    await expect(page.getByRole('alert')).toContainText('taking longer than it should');

    await page.evaluate(() => { (window as unknown as { __stuckLogin: boolean }).__stuckLogin = false; });
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });
});

test.describe('the "Creating your household" overlay on Confirm', () => {
  // registerHousehold's first half: the address follows its pattern (the `huddle+e2e-` prefix is
  // what keeps the send a no-op and lets cleanup find it -- e2e-tests.md, "the test email pattern").
  async function startRegistration(page: Page, request: APIRequestContext, name: string) {
    const email = `huddle+e2e-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 12)}@starner.co`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill(name);
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);
    const { apiUrl } = await (await request.get('/config.json')).json();
    return fetchPendingCode(request, apiUrl, email);
  }

  test('covers the wait from Confirm until the new household opens', async ({ page, request }) => {
    const code = await startRegistration(page, request, 'Sage');
    const confirm = holdRequests(page, '**/api/auth/confirm-email');
    await confirm.install();
    const overlay = page.getByTestId('signing-in-overlay');

    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(overlay).toContainText('Creating your household…');
    await expect.poll(() => confirm.held.length).toBe(1);
    await expect(page).toHaveURL(/\/confirm-email/);
    confirm.held[0]();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(overlay).toBeHidden();
    // A brand-new household: the first-run welcome follows, as it always has.
    await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeVisible();
  });

  test('a wrong code comes back to the code screen with the reason', async ({ page, request }) => {
    const code = await startRegistration(page, request, 'Tatum');
    const wrong = code === '000000' ? '111111' : '000000';
    const overlay = page.getByTestId('signing-in-overlay');

    await page.getByPlaceholder('123456').fill(wrong);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(overlay).toBeHidden();
    await expect(page).toHaveURL(/\/confirm-email/);

    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });
});
