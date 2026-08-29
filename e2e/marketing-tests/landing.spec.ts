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

    // Import SHIPPED (PR #200) and is now gated on Pro, so the "Coming soon" badge that used to
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

    // Import is the Pro line: one tick, on the Pro side only.
    const importRow = pricing.locator('tr', { hasText: 'Import past workouts' });
    await expect(importRow.getByRole('img', { name: 'Included', exact: true })).toHaveCount(1);
    await expect(importRow.getByRole('img', { name: 'Not included', exact: true })).toHaveCount(1);
  });

  test('the hero offers both plans, and the legal pages are reachable', async ({ page }) => {
    await page.goto('/');

    // "Go Pro" appears twice on the page (hero and pricing card), so this is scoped to the hero
    // rather than matched globally -- an unscoped getByRole would be a strict-mode violation.
    const hero = page.locator('.hero');
    await expect(hero.getByRole('link', { name: 'Start free' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Go Pro' })).toBeVisible();

    // Taking payment without these is not something to discover in production.
    const footer = page.locator('.site-footer');
    await expect(footer.getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
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

  test('the household clip loads only once scrolled near, and never under reduced motion', async ({ page }) => {
    const video = page.locator('video.js-lazy-video');

    // Reduced motion: the clip must never be fetched -- the poster frame is the whole experience.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const clipRequests: string[] = [];
    page.on('request', (r) => r.url().includes('app-household.webm') && clipRequests.push(r.url()));
    await video.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(clipRequests).toEqual([]);
    await expect(video).toHaveAttribute('poster', /app-household-poster\.jpg/);

    // Normal motion: nothing fetched before the section is in view, something fetched after.
    // A fresh goto (not reload) so the scroll position from the reduced-motion check above --
    // which deliberately scrolled the video into view -- doesn't carry over and pre-empt this.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const beforeScroll: string[] = [];
    page.on('request', (r) => r.url().includes('app-household.webm') && beforeScroll.push(r.url()));
    await page.waitForTimeout(300);
    expect(beforeScroll).toEqual([]);

    await video.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentSrc), { timeout: 5000 })
      .toContain('app-household.webm');
  });

  // Regression test for a real bug (2026-08-24, found on the deployed lower site): the base
  // `img { height: auto }` rule doesn't cover <video>, so the household clip's `height="761"`
  // HTML attribute applied as a literal CSS height regardless of how far width:100% shrank the
  // box -- barely visible on desktop (~10% too tall), badly broken on a phone-width column
  // (nearly 2x too tall, most of the card empty). Assert the rendered box keeps the video's own
  // aspect ratio at both a phone and a desktop width, rather than assuming a fix at one width
  // implies the other.
  test('the household clip keeps its own aspect ratio at both a phone and a desktop width', async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const context = await page.context().browser()!.newContext({ viewport });
      const p = await context.newPage();
      await p.goto('/');
      const video = p.locator('video.js-lazy-video');
      await video.scrollIntoViewIfNeeded();
      const ratios = await video.evaluate((v: HTMLVideoElement) => ({
        rendered: v.clientWidth / v.clientHeight,
        // videoWidth/videoHeight report the clip's real intrinsic resolution once metadata
        // loads; falling back to the width/height HTML attributes covers a slow/blocked load.
        natural: (v.videoWidth || Number(v.getAttribute('width'))) / (v.videoHeight || Number(v.getAttribute('height'))),
      }));
      expect(ratios.rendered, `at ${viewport.width}px wide`).toBeCloseTo(ratios.natural, 1);
      await context.close();
    }
  });
});
