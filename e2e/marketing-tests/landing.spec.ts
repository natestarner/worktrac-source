import { test, expect } from '@playwright/test';
import { expectedOrigins } from './site-origins';

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

    // Each deploy fills its own app origin into the CTAs (scripts/fill-site-origins.sh), so lower's
    // page sends people to lower's app and production's to production's.
    const { app } = expectedOrigins(page.url());

    const hrefs = await page.locator('a[href*="/login"], a[href*="/register"]').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).href)
    );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(new URL(href).origin).toBe(app);
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

  // The iPhone and iPad app: Apple's badge in the hero and the closing band, and Safari's Smart App
  // Banner, all naming one listing. check-marketing.sh checks the ids agree across every page; this
  // checks a visitor actually sees the badge, at no less than the 40px Apple requires.
  test('offers the App Store app beside the web sign-up', async ({ page }) => {
    await page.goto('/');

    const listing = /^https:\/\/apps\.apple\.com\/us\/app\/huddle-workout-tracker\/id\d+$/;
    for (const scope of ['.hero', '.cta-final']) {
      const badge = page.locator(scope).getByRole('link', { name: 'Download on the App Store' });
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute('href', listing);
      // Loaded, not just present: until it is, Chrome draws the alt text in its place.
      const img = badge.locator('img');
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const box = await img.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }

    const banner = await page.locator('meta[name="apple-itunes-app"]').getAttribute('content');
    const id = (await page.locator('.hero .store-badge').getAttribute('href'))!.split('/id')[1];
    expect(banner).toBe(`app-id=${id}`);

    // The FAQ used to answer "No app store" -- it must point at the app now.
    const faq = page.locator('.faq__item', { hasText: 'Is there an app to install?' });
    await expect(faq.getByRole('link', { name: 'get Huddle from the App Store' })).toHaveAttribute('href', listing);
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
  for (const path of ['/', '/for-trainers.html', '/pricing.html', '/terms.html', '/privacy.html', '/support.html', '/404.html']) {
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

  // The clip ships twice (H.264 MP4 for Safari and iPhones, VP9 WebM for browsers without H.264) and
  // the browser picks by each <source>'s type, so this accepts whichever one it chose.
  test('the household clip loads only once scrolled near, and never under reduced motion', async ({ page }) => {
    const video = page.locator('video.js-lazy-video');
    const isClip = (url: string) => /app-household\.(mp4|webm)$/.test(url);

    // Reduced motion: the clip must never be fetched -- the poster frame is the whole experience.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const clipRequests: string[] = [];
    page.on('request', (r) => isClip(r.url()) && clipRequests.push(r.url()));
    await video.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(clipRequests).toEqual([]);
    await expect(video).toHaveAttribute('poster', /app-household-poster\.jpg/);

    // Normal motion: nothing fetched before the section is in view, something fetched after.
    // A fresh goto so the scroll position from the check above doesn't carry over.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const beforeScroll: string[] = [];
    page.on('request', (r) => isClip(r.url()) && beforeScroll.push(r.url()));
    await page.waitForTimeout(300);
    expect(beforeScroll).toEqual([]);

    await video.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentSrc), { timeout: 5000 })
      .toMatch(/app-household\.(mp4|webm)$/);
  });

  // Safari plays only the MP4, and this site sends nosniff, so a clip served as
  // application/octet-stream shows Safari the poster and nothing else -- shipped that way to lower on
  // 2026-10-28. The local preview server types it right regardless, so this only bites when the suite
  // runs against a deployed site (MARKETING_BASE_URL); check-marketing.sh check 11 guards the config.
  test('the household clip is served as video, in every format', async ({ page, request }) => {
    await page.goto('/');
    const sources = await page.locator('video.js-lazy-video source').evaluateAll((els) => els.map((el) => el.getAttribute('data-src')!));
    expect(sources.length).toBeGreaterThan(1);
    for (const src of sources) {
      const res = await request.get(src, { headers: { Range: 'bytes=0-99' } });
      expect(res.status(), src).toBeLessThan(300);
      expect(res.headers()['content-type'], src).toMatch(/^video\//);
    }
  });

  // The base `img { height: auto }` rule doesn't cover <video>, so a clip's height attribute applies
  // as a literal CSS height unless something says otherwise -- barely visible on desktop, badly
  // broken in a phone-width column (2026-08-24). Assert the rendered box keeps the clip's shape at
  // both widths rather than assuming one implies the other.
  test('the household clip keeps its own aspect ratio at both a phone and a desktop width', async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const context = await page.context().browser()!.newContext({ viewport });
      const p = await context.newPage();
      await p.goto('/');
      const video = p.locator('video.js-lazy-video');
      await video.scrollIntoViewIfNeeded();
      const ratios = await video.evaluate((v: HTMLVideoElement) => ({
        rendered: v.clientWidth / v.clientHeight,
        natural: (v.videoWidth || Number(v.getAttribute('width'))) / (v.videoHeight || Number(v.getAttribute('height'))),
      }));
      expect(ratios.rendered, `at ${viewport.width}px wide`).toBeCloseTo(ratios.natural, 1);
      await context.close();
    }
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
      // Inside a <picture>, the file loaded may be a <source>'s (the phone-width capture on a small
      // screen), which declares its own size -- check whichever one the browser chose.
      const { src, declared, natural } = await img.evaluate((el: HTMLImageElement) => {
        const chosen = [...(el.parentElement?.querySelectorAll('source') ?? [])].find(
          (s) => s.hasAttribute('width') && el.currentSrc.endsWith(s.getAttribute('srcset')!),
        );
        const sized = chosen ?? el;
        return {
          src: el.currentSrc,
          declared: Number(sized.getAttribute('width')) / Number(sized.getAttribute('height')),
          natural: el.naturalWidth / el.naturalHeight,
        };
      });
      expect(declared, src).toBeCloseTo(natural, 2);
    }
  });
});
