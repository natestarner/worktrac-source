import { expect, test } from '@playwright/test';

// The one place a four-column comparison belongs. The homepage and the trainer page each show only
// the plans their own audience would buy; this is for somebody deliberately comparing.
test.describe('pricing page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing.html');
  });

  test('loads without console errors and with no broken assets', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

    await page.reload();
    await expect(page.getByRole('table')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('compares all three tiers somebody can buy', async ({ page }) => {
    const head = page.getByRole('row').first();

    for (const tier of ['Free', 'Plus', 'Pro']) {
      await expect(head.getByRole('columnheader', { name: tier, exact: true })).toBeVisible();
    }
    // TEAM is not named anywhere: advertising a tier nobody can buy is the one thing a pricing page
    // must not do.
    await expect(page.getByText('Team', { exact: true })).toHaveCount(0);
  });

  // ⚠️ EVERY CELL NEEDS ITS data-label. Below 720px .compare flattens into stacked rows and each
  // cell draws its column name from td::before { content: attr(data-label) } -- a cell without one
  // loses its heading entirely on a phone, which is most of the traffic. This is the tripwire the
  // plan called out, and it is invisible at desktop width.
  test('every data cell carries the label its mobile layout needs', async ({ page }) => {
    const missing = await page.locator('table.compare td:not([data-label])').count();

    expect(missing).toBe(0);
  });

  // Export being free on every tier is a standing commitment in billing.md, and this is the page
  // somebody checks it on before paying.
  test('says export is free on every plan', async ({ page }) => {
    const row = page.getByRole('row').filter({ hasText: 'Export your data' });

    await expect(row.getByText('Yes')).toHaveCount(3);
  });

  // ⚠️ The softened privacy claim, same as the trainer page: what shipped is one account-wide
  // switch, not per-client granularity.
  test('describes privacy as between people rather than per client', async ({ page }) => {
    await expect(page.getByText(/private from each other/i)).toBeVisible();
  });

  test('does not scroll horizontally', async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
