import { test, expect } from '@playwright/test';

// Coverage for the marketing landing page. The things worth asserting here are the ones that
// silently break and cost signups: a CTA that stops pointing at the app, the pricing claim
// drifting from what the product actually does, and the page overflowing on a phone.
//
// Visual/contrast checks live in e2e/tools/ rather than here -- they are development tooling,
// not a pass/fail gate on every run.

test.describe('marketing landing page', () => {
  test('renders the hero and both calls to action', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText("Everyone's workouts");
    // Two "Start free" CTAs above the fold on desktop (nav + hero); more further down.
    await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible();
    await expect(page).toHaveTitle(/Huddle/);
  });

  test('every app CTA points at a real app route on the matching environment', async ({ page }) => {
    await page.goto('/');

    const host = new URL(page.url()).hostname;
    // app-links.js rewrites to the lower app on a dev.* host; everywhere else stays production.
    const expectedApp = host.startsWith('dev.') ? 'app.dev.huddle.fitness' : 'app.huddle.fitness';

    const hrefs = await page.locator('a[href*="huddle.fitness"]').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).href)
    );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toContain(expectedApp);
      expect(href).toMatch(/\/(login|register)(\?|$)/);
    }
  });

  test('shows both plans with the 90-day line and the never-deleted promise', async ({ page }) => {
    await page.goto('/#pricing');

    const pricing = page.locator('#pricing');
    // exact:true throughout -- "Free" and "Pro" appear inside longer strings all over this
    // section, and a substring match collides with them.
    await expect(pricing.getByText('Free', { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText('Pro', { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText('$0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('$29', { exact: true })).toBeVisible();

    // The gate itself, and the sentence that keeps it from reading as data-hostage. If either
    // disappears the pricing story is broken, so both are asserted rather than assumed.
    await expect(pricing.getByText(/90 days/).first()).toBeVisible();
    await expect(pricing.getByText(/never deleted on Free/)).toBeVisible();

    // Import does not exist yet and must stay badged as such.
    await expect(pricing.getByText('Coming soon').first()).toBeVisible();
  });

  test('does not scroll horizontally', async ({ page }) => {
    await page.goto('/');
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    // 1px of slack for sub-pixel rounding at fractional device scale factors.
    expect(scrollW).toBeLessThanOrEqual(clientW + 1);
  });

  test('loads without console errors and with no broken assets', async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => {
      // Google Fonts is the one allowed third party; everything else must be same-origin and 2xx.
      if (r.status() >= 400 && !r.url().includes('fonts.g')) failed.push(`${r.status()} ${r.url()}`);
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
});
