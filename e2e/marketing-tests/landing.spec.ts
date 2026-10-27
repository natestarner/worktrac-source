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

    // Both halves of the promise: the shared-screen claim and the emotional one. They are the
    // page's whole positioning, so losing either in an edit should fail here. The emotional half
    // moved from a second h1 line into the lead paragraph (2026-08-23) -- the old h1 line
    // duplicated it rather than adding to it, so it was cut, not relocated as-is; assert each
    // where it actually lives now.
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText("whole family's workout");
    await expect(page.locator('.hero__lead')).toContainText('celebrate your PRs together');
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
    // exact:true throughout -- "Free" and "Plus" appear inside longer strings all over this
    // section, and a substring match collides with them.
    await expect(pricing.getByText('Free', { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText('Plus', { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText('$0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('$29', { exact: true })).toBeVisible();

    // The gate itself, and the sentence that keeps it from reading as data-hostage. If either
    // disappears the pricing story is broken, so both are asserted rather than assumed.
    await expect(pricing.getByText(/90 days/).first()).toBeVisible();
    await expect(pricing.getByText(/never deleted on Free/)).toBeVisible();

    // Import SHIPPED (PR #200) and is now gated on Plus, so the "Coming soon" badge that used to
    // be asserted here is gone. What replaces it is the stronger claim: the page must contain no
    // future-tense hedging at all, because every row on it is now enforced in the product.
    await expect(pricing.getByText('Coming soon')).toHaveCount(0);

    // Export is free on BOTH plans -- it is the one thing a household must never have to pay to
    // get back, and the compare row says so on the Free side too.
    // exact:true throughout -- Playwright matches accessible names as a case-insensitive
    // SUBSTRING, and "Not included" contains "Included". Without it every tick assertion silently
    // counts the dashes too, which is how this was first written and why it failed.
    const exportRow = pricing.locator('tr', { hasText: 'Export all data to CSV' });
    await expect(exportRow.getByRole('img', { name: 'Included', exact: true })).toHaveCount(2);
    await expect(exportRow.getByRole('img', { name: 'Not included', exact: true })).toHaveCount(0);

    // Import is the Plus line: one tick, on the Plus side only.
    const importRow = pricing.locator('tr', { hasText: 'Import past workouts' });
    await expect(importRow.getByRole('img', { name: 'Included', exact: true })).toHaveCount(1);
    await expect(importRow.getByRole('img', { name: 'Not included', exact: true })).toHaveCount(1);
  });

  test('the hero offers both plans, and the legal pages are reachable', async ({ page }) => {
    await page.goto('/');

    // "Go Plus" appears twice on the page (hero and pricing card), so this is scoped to the hero
    // rather than matched globally -- an unscoped getByRole would be a strict-mode violation.
    const hero = page.locator('.hero');
    await expect(hero.getByRole('link', { name: 'Start free' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Go Plus' })).toBeVisible();

    // Taking payment without these is not something to discover in production.
    const footer = page.locator('.site-footer');
    await expect(footer.getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
  });

  // Stripe receipts and the App Store listing both name this page as the support URL, and the
  // people who follow it (a charge they don't recognize, a forgotten password) are mostly signed
  // out -- which is why it lives here and not at the app's own /app/help.
  test('the support page is reachable from the footer and gives a way to reach us', async ({ page }) => {
    await page.goto('/');
    await page.locator('.site-footer').getByRole('link', { name: 'Support' }).click();
    await expect(page).toHaveURL(/\/support\.html$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: 'support@huddle.fitness' }).first()
    ).toHaveAttribute('href', 'mailto:support@huddle.fitness');
  });

  // Apple and Google verify the developer against a website that names the seller, and the seller
  // name must match the legal entity exactly -- "Starner Consulting" without the "Co." is not it.
  // Every page, because a reviewer can land on any of them.
  for (const path of ['/', '/for-trainers.html', '/pricing.html', '/terms.html', '/privacy.html', '/support.html']) {
    test(`${path} names the legal entity in its footer`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.site-footer__legal')).toHaveText(
        'Huddle is made by Starner Consulting Co.'
      );
    });
  }

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

  // Regression test for a real bug (2026-08-23, not theoretical): capping animation-duration to
  // 0.01ms for prefers-reduced-motion does NOT reliably land a fill-mode:both animation on its
  // `to` keyframe in Chromium -- every .reveal section rendered permanently at opacity:0, i.e.
  // the whole page below the hero was blank for anyone with that OS setting on. Fixed with an
  // explicit resting-state override; this asserts it stays fixed.
  test('every scroll-reveal section is visible under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const revealed = page.locator('.reveal');
    const count = await revealed.count();
    expect(count).toBeGreaterThan(0);

    const opacities = await revealed.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacities).toEqual(new Array(count).fill('1'));

    // Same failure mode hit the hero's accent word (a color transition, not opacity) --
    // separately overridden, so covered separately rather than assumed to follow from the above.
    const accentColor = await page.locator('.hero__title em').evaluate((el) => getComputedStyle(el).color);
    expect(accentColor).not.toBe('rgb(28, 27, 25)'); // --color-text: never stuck on the pre-animation ink color
  });

  // Every product screenshot is re-taken by tools/marketing-demo-shots.mjs, and each <img> declares
  // its size up front so the page doesn't jump while they load. A re-take that changes a capture's
  // shape without the markup following stretches it -- silently, and differently at every width.
  test('every product image is declared at its real shape', async ({ page }) => {
    await page.goto('/');
    const images = page.locator('main img[src*="/assets/shots/"]');
    expect(await images.count()).toBeGreaterThan(0);
    for (const img of await images.all()) {
      // Scrolled near so a lazy one loads. The hero tablet is hidden on phones; it isn't lazy, so it
      // loads without being scrolled to.
      if (await img.isVisible()) await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const { src, declared, natural } = await img.evaluate((el: HTMLImageElement) => ({
        src: el.getAttribute('src'),
        declared: Number(el.getAttribute('width')) / Number(el.getAttribute('height')),
        natural: el.naturalWidth / el.naturalHeight,
      }));
      expect(declared, src!).toBeCloseTo(natural, 2);
    }
  });
});
