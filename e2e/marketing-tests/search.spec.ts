import { test, expect, type Page } from '@playwright/test';

// What search engines and AI assistants read off the site, as opposed to what a visitor sees. None
// of it is visible, which is exactly why it needs asserting: structured data that has drifted from
// the page, or a not-found URL answering 200, looks perfect in a browser.

const INDEXABLE = ['/', '/for-trainers.html', '/pricing.html', '/support.html', '/terms.html', '/privacy.html'];

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

async function structuredData(page: Page): Promise<any[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  // JSON.parse throwing here is the failure: one stray comma and search engines ignore the block.
  return blocks.flatMap((b) => {
    const parsed = JSON.parse(b);
    return parsed['@graph'] ?? [parsed];
  });
}

test.describe('what search engines read', () => {
  for (const path of INDEXABLE) {
    test(`${path} has exactly one h1 and parseable structured data`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await structuredData(page);
    });
  }

  // The FAQPage markup is a second copy of the visible FAQ (there is no build step to generate
  // it), so an edit to one answer would otherwise leave search engines and AI assistants quoting
  // the old wording.
  for (const path of ['/', '/for-trainers.html']) {
    test(`${path}'s FAQ structured data matches the visible FAQ word for word`, async ({ page }) => {
      await page.goto(path);
      const faq = (await structuredData(page)).find((n) => n['@type'] === 'FAQPage');
      expect(faq, 'FAQPage structured data').toBeTruthy();

      const visible = await page.locator('.faq__item').evaluateAll((items) =>
        items.map((item) => ({
          q: item.querySelector('.faq__q')?.textContent ?? '',
          a: item.querySelector('.prose')?.textContent ?? '',
        }))
      );
      const marked = faq.mainEntity.map((e: any) => ({ q: e.name, a: e.acceptedAnswer.text }));

      expect(marked).toEqual(visible.map(({ q, a }) => ({ q: normalize(q), a: normalize(a) })));
    });
  }

  // The app entity's offers restate prices the pricing page owns. A price change there must reach
  // here too, or AI assistants answering "how much is Huddle?" will quote the old one.
  test('every structured-data price appears on the pricing page', async ({ page }) => {
    await page.goto('/');
    const app = (await structuredData(page)).find((n) => n['@type'] === 'SoftwareApplication');
    expect(app?.name).toBe('Huddle');
    expect(app.offers.length).toBeGreaterThan(0);

    await page.goto('/pricing.html');
    const pricing = normalize(await page.locator('main').innerText());
    // The price WITH its period ("$29 / year", "$19 a month"): bare "$39" is also a Pro tier, so a
    // Plus price edited to 39 would otherwise still match.
    for (const offer of app.offers) {
      const unit = offer.priceSpecification?.unitText;
      const shown = unit ? `\\$${offer.price} (/|a|per) ${unit}\\b` : `\\$${offer.price}\\b`;
      expect(pricing, `${offer.name} at $${offer.price}${unit ? ' a ' + unit : ''}`).toMatch(new RegExp(shown));
    }
  });

  // Locally this only proves python's http.server 404s; the SWA override (which used to answer
  // 200 with the homepage) is exercised when this suite runs against a deployed environment.
  // check-marketing.sh check 12 guards the config itself.
  test('an unknown URL answers 404, not the homepage', async ({ page }) => {
    const response = await page.goto('/no-such-page-' + Date.now());
    expect(response?.status()).toBe(404);
  });

  test('the not-found page is noindex and points somewhere useful', async ({ page }) => {
    await page.goto('/404.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("That page isn't here");
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'Huddle for families' })).toHaveAttribute('href', '/');
    await expect(main.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support.html');
  });
});
