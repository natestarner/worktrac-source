import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';

// The plan screen, both sides of it.
//
// STRIPE IS DELIBERATELY ABSENT from this suite. Plans are set through the test-support endpoint,
// which writes the same `comped` flag a founding household uses -- so these specs exercise the
// real entitlement derivation rather than a fixture, and the suite needs no Stripe credentials in
// any environment. Driving Stripe's own card form would be testing Stripe, slowly and flakily.
test.describe('billing', () => {
  test('a Free household is offered Pro, with yearly leading', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await page.getByRole('button', { name: /Account|Nate/ }).click();
    await page.getByRole('menuitem', { name: 'Plan & billing' }).click();

    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    // Yearly leads because the marketing pricing card headlines $29/year -- the price must not
    // change shape between the page they just read and the screen they pay on.
    await expect(page.getByRole('radio', { name: /Yearly/ })).toBeChecked();

    // Free is permanent, so deferring costs nothing. This is an equal-weight escape, not fine print.
    await expect(page.getByRole('button', { name: /Start with Free/ })).toBeVisible();
  });

  test('the header offers Go Pro on Free and says Pro once upgraded', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');

    // "Go Pro" in the header and "Upgrade to Pro" on the billing screen are deliberately
    // non-containing: Playwright matches accessible names as a case-insensitive substring, so a
    // shared name would make every assertion on either one ambiguous.
    await expect(page.getByRole('link', { name: 'Go Pro' })).toBeVisible();

    await setBillingPlan(request, email, 'PRO');
    await page.reload();

    await expect(page.getByRole('link', { name: 'Go Pro' })).toHaveCount(0);
    // exact:true -- "Pro" is a substring of "Profile", which is the account menu's first item and
    // lives in this same header.
    await expect(page.getByText('Pro', { exact: true })).toBeVisible();
  });

  test('a Pro household sees its plan rather than an upgrade', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PRO');

    await page.goto('/app/billing');

    await expect(page.getByText('Huddle Pro')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);
  });

  // The gates, from the outside. Both halves matter: the Pro feature is withheld, and the thing
  // that must NEVER be withheld is still there.
  test('importing is offered to Pro and explained to Free, while export is always offered',
    async ({ page, request }) => {
      const email = await registerHousehold(page, request, 'Nate');

      await page.goto('/app/settings');
      await expect(page.getByRole('button', { name: 'Import data' })).toHaveCount(0);
      await expect(page.getByText(/Importing past workouts is part of Pro/)).toBeVisible();
      // ⚠️ Exporting is free on BOTH plans. A household must always be able to take its own data
      // out, and the privacy policy's self-serve data rights depend on this staying true.
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();

      await setBillingPlan(request, email, 'PRO');
      await page.reload();

      await expect(page.getByRole('button', { name: 'Import data' })).toBeVisible();
      await expect(page.getByText(/part of Pro/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    });

  // The handbook is a route inside the app precisely so it works with no signal, and it now has to
  // explain the plans. A deep link into the new section is API -- renaming the id breaks it.
  test('the handbook explains the plans at a stable anchor', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await page.goto('/app/help#plan');

    await expect(page.getByRole('heading', { name: 'Free and Pro' })).toBeVisible();
    await expect(page.getByText(/hidden, not removed/)).toBeVisible();
  });
});
