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
    // These answers used to sit behind a <details> the test had to open first. The page now uses
    // the same open .faq-grid the homepage does, so they are on screen without a tap -- which is
    // what the old test was reaching for anyway: a promise about somebody's data should not be
    // something a reader has to go looking for.
    await expect(faq.getByText(/export their full history to CSV before they go, at no cost/i)).toBeVisible();
    await expect(faq.getByText(/Importing a spreadsheet needs a paid plan/i)).toBeVisible();
  });

  test('sends its CTAs at the Pro signup', async ({ page }) => {
    const ctas = page.getByRole('link', { name: 'Get started', exact: true });

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

  // ⚠️ This page carries the site's longest CTA label, so it is where the shared header runs out of
  // room first -- but the failure was never page-specific. With the nav free to shrink its items
  // below their content width, "Log in" broke after "Log" and the CTA label came apart inside its
  // own pill, at every width up to 430px. The no-horizontal-scroll test below passed throughout:
  // wrapping is precisely how the browser avoids overflow, so overflow alone never sees this.
  //
  // 320px rather than the project's 390px because that is the narrowest width the header has to
  // survive, and the budget there is genuinely tight -- see the .brand__word rule in styles.css.
  test('keeps the header on one row, with no label broken across lines', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });

    const header = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('.site-nav > *')].filter(
        (el) => getComputedStyle(el).display !== 'none',
      );

      // A wrapped label renders as more than one client rect over its own contents. Measuring
      // element height instead would miss it: .btn has a min-height tall enough to hide a second
      // line, which is how "Start a practice" stayed broken without anything failing.
      const wrapped = visible
        .filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length > 1;
        })
        .map((el) => el.textContent.trim());

      // Vertical centres, not tops: .site-nav is align-items: center, so a 46px button and a 19px
      // link sitting correctly on one row have different tops by design.
      const centres = new Set(
        visible.map((el) => {
          const r = el.getBoundingClientRect();
          return Math.round(r.top + r.height / 2);
        }),
      );

      return { wrapped, rows: centres.size, labels: visible.map((el) => el.textContent.trim()) };
    });

    expect(header.wrapped).toEqual([]);
    expect(header.rows).toBe(1);
    // Both are load-bearing: a fix that simply hid the CTA on phones would satisfy everything above.
    expect(header.labels.length).toBe(2);
  });

  // ⚠️ The companion to the test above, and it exists because that one ALONE was satisfied by a
  // fix that deleted the brand name. "Nothing wraps" is trivially true of a header you have
  // emptied, so the first fix here hid `.brand__word` below 460px — which is every iPhone in
  // portrait (375–440px), and the word "Huddle" simply vanished from the header on all of them.
  //
  // Fitting the row and keeping the name are two requirements, so they need two assertions.
  // Whichever one a future change optimises for, the other fails.
  //
  // These are real device widths, not round numbers: 375 = SE / 8 / X / 13 mini, 390 = 12–16,
  // 393 = 14–15 Pro, 414 = Plus & XR, 430 = 15 Pro Max. 320 (the original SE) is the documented
  // exception where the mark genuinely does carry the brand alone — see styles.css.
  for (const width of [375, 390, 393, 414, 430]) {
    test(`shows the Huddle wordmark at ${width}px, the width of a real iPhone in portrait`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });

      const brand = await page.evaluate(() => {
        const word = document.querySelector('.brand__word');
        const rect = word.getBoundingClientRect();
        return {
          displayed: getComputedStyle(word).display !== 'none',
          // Painted, not merely present: display:none is one way to lose it, a zero box is another.
          width: Math.round(rect.width),
          text: word.textContent.trim(),
          markVisible: document.querySelector('.brand__mark').getBoundingClientRect().width > 0,
        };
      });

      expect(brand.displayed).toBe(true);
      expect(brand.width).toBeGreaterThan(0);
      expect(brand.text).toBe('Huddle');
      // The mark is not an acceptable casualty of making room for the word either.
      expect(brand.markVisible).toBe(true);
    });
  }

  test('does not scroll horizontally', async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
