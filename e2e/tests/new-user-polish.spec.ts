import { test, expect, Page } from '@playwright/test';
import { fetchPendingCode, registerHousehold } from './support/auth';
import { dismissPrCelebration, logSetAt, pickExercise } from './support/exercises';

// Four rough edges a brand-new person hit in the 2026-11-23 walk-through, each a layout or a flow
// that only a real browser can show (jsdom lays nothing out, and the confirm-email round trip
// crosses two routes and the backend).

async function apiUrl(page: Page) {
  const response = await page.request.get('/config.json');
  const { apiUrl: url } = await response.json();
  return url as string;
}

test.describe('a mistyped email at sign-up', () => {
  // The confirm screen offered only Confirm and Resend, both acting on the wrong address, and the
  // App Store app has no browser Back button. "Use a different email" goes back with the form
  // filled in (never the password), and the corrected address signs up normally.
  test('can be fixed from the confirm screen without retyping the form', async ({ page, request }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wrong = `huddle+e2e-typo-${stamp}@starner.co`;
    const right = `huddle+e2e-fixed-${stamp}@starner.co`;

    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Jordan');
    await page.getByPlaceholder('you@example.com').fill(wrong);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);
    await expect(page.getByText(/Check your spam or junk folder/)).toBeVisible();

    await page.getByRole('button', { name: 'Use a different email' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByPlaceholder('e.g. Alex')).toHaveValue('Jordan');
    await expect(page.getByPlaceholder('you@example.com')).toHaveValue(wrong);
    await expect(page.getByPlaceholder('At least 8 characters')).toHaveValue('');

    await page.getByPlaceholder('you@example.com').fill(right);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);
    await expect(page.getByText(right)).toBeVisible();

    const code = await fetchPendingCode(request, await apiUrl(page), right);
    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // At 390px the bar's one line ran out of room the moment the rest timer appeared, and cut the
  // start time to "started 1…". On a phone the time now sits on its own line under the label.
  test('the session bar shows the whole start time while the rest timer runs', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 135, 5);
    await dismissPrCelebration(page);

    const bar = page.locator('.session-bar');
    await expect(bar.getByRole('img', { name: /^Rest / })).toBeVisible();
    const when = bar.locator('.session-bar-status-when');
    await expect(when).toBeVisible();
    await expect(when).toHaveText(/^started \d{1,2}:\d{2}\s?[AP]M$/);
    // Fully drawn: nothing clipped by an ellipsis.
    expect(await when.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // Still one text for tests and screen readers, middot included.
    await expect(bar.getByText(/Session in progress · started/)).toBeVisible();
  });

  // A date and a time input side by side ran past the dialog's right edge at 390px.
  test("Log a past workout's date and time stay inside the dialog", async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Log a past workout' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log a past workout' });
    await expect(dialog).toBeVisible();

    const panel = (await dialog.boundingBox())!;
    for (const input of [dialog.locator('input[type="date"]'), dialog.locator('input[type="time"]')]) {
      const box = (await input.boundingBox())!;
      expect(box.x, 'starts inside the dialog').toBeGreaterThanOrEqual(panel.x - 1);
      expect(box.x + box.width, 'ends inside the dialog').toBeLessThanOrEqual(panel.x + panel.width + 1);
    }
  });
});

test.describe('on an iPad held sideways', () => {
  test.use({ viewport: { width: 1194, height: 834 } });

  // At a fixed 10px a square, the 26 weeks filled about a third of the card on an iPad and read
  // as unfinished. The squares now grow to fill a wide card (phones keep 10px).
  test('the consistency grid fills most of its card', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    // Trends shows its grid once there is something to chart.
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 135, 5);
    await dismissPrCelebration(page);
    await page.getByRole('link', { name: 'Trends' }).click();
    const grid = page.getByTestId('consistency-grid');
    await expect(grid).toBeVisible();
    const scroll = (await page.getByTestId('consistency-scroll').boundingBox())!;
    await expect.poll(async () => (await grid.boundingBox())!.width / scroll.width).toBeGreaterThan(0.7);
  });
});
