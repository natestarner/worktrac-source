import { expect, test } from '@playwright/test';

// The trainer audience page. Shares a header, footer and stylesheet with the homepage, so most of
// what can break here is what it says rather than how it looks -- and the copy carries promises the
// product has to keep.
test.describe('for-trainers page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/for-trainers.html');
  });

  test('loads without console errors and with no broken assets', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
    });

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(problems).toEqual([]);
  });

  // ⚠️ THE PRICES ARE THE CONTRACT. These four numbers exist in three places -- here, planCopy.js,
  // and the Stripe prices themselves -- and a page promising $39 while Stripe charges $49 is the
  // kind of thing a customer discovers at the card form. If a band changes, it changes here too.
  test('names every Pro band at the price it is sold for', async ({ page }) => {
    const pricing = page.locator('#pricing');

    for (const [band, monthly, yearly] of [
      ['Starter', '$19', '$190'],
      ['Studio', '$39', '$390'],
      ['Practice', '$79', '$790'],
      ['Unlimited', '$149', '$1,490'],
    ]) {
      await expect(pricing.getByRole('rowheader', { name: band, exact: true })).toBeVisible();
      await expect(pricing.getByText(monthly, { exact: true })).toBeVisible();
      await expect(pricing.getByText(yearly, { exact: true })).toBeVisible();
    }
  });

  // ⚠️ The privacy claim must match what Phase 3 actually shipped: ONE account-wide switch,
  // defaulting to private. "Each client's data is private" would promise per-client granularity
  // that does not exist. The softened wording is a decision, recorded in the plan's STATUS block.
  test('promises privacy the product can actually keep', async ({ page }) => {
    await expect(page.getByText(/clients do not see each other/i)).toBeVisible();

    // The password promise, verbatim in spirit and load-bearing everywhere it appears.
    await expect(page.getByText(/cannot see or set their password/i)).toBeVisible();
  });

  // Export is free on every tier and must stay so -- it is what makes "your data lives in your
  // trainer's account" acceptable rather than lock-in. Import is Plus-gated, so the page must not
  // imply a free landing spot. Both halves are asserted because the honest version needs both.
  test('states the export/import round trip exactly', async ({ page }) => {
    const faq = page.locator('#faq');
    // Behind a <details>, so open it: asserting on hidden DOM would pass for text no reader can
    // actually reach, which for a promise about somebody's data is the wrong thing to verify.
    await faq.getByRole('group').filter({ hasText: 'What happens if a client leaves me?' }).click();

    await expect(faq.getByText(/export their full history to CSV before they go, at no cost/i)).toBeVisible();
    await expect(faq.getByText(/Importing a spreadsheet needs a paid plan/i)).toBeVisible();
  });

  test('sends its CTAs at the Pro signup', async ({ page }) => {
    const ctas = page.getByRole('link', { name: 'Start a practice' });

    await expect(ctas).toHaveCount(3);
    for (const href of await ctas.evaluateAll((links) => links.map((l) => l.getAttribute('href')))) {
      expect(href).toContain('plan=pro');
    }
  });

  // Each page must send families and trainers to the other one, or the two audiences only ever
  // arrive by search and the wrong one bounces.
  test('links back to the family page', async ({ page }) => {
    await expect(page.locator('.site-footer').getByRole('link', { name: 'For families' })).toBeVisible();

    await page.goto('/');
    await expect(page.locator('.site-footer').getByRole('link', { name: 'For trainers' })).toBeVisible();
  });

  test('does not scroll horizontally', async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
