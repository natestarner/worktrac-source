import { test, expect } from '@playwright/test';
import { expectedOrigins } from './site-origins';

// Each environment's pages name only that environment, in the raw HTML a link preview reads.
//
// The pages ship with __SITE_ORIGIN__ / __APP_ORIGIN__ / __SITE_ROBOTS__ placeholders and every
// deploy fills them from its own config (scripts/fill-site-origins.sh). These read the response
// body, not the DOM: iMessage, Slack and crawlers never run the page's scripts, which is exactly how
// dev.huddle.fitness came to unfurl with production's share image -- a file production didn't have
// yet, so the preview showed no picture (2026-10-29).

const PAGES = ['/', '/for-trainers.html', '/pricing.html', '/privacy.html', '/terms.html', '/support.html'];

test.describe('per-environment origins', () => {
  for (const path of PAGES) {
    test(`${path} names only its own environment`, async ({ request, baseURL }) => {
      const { site, app, robots } = expectedOrigins(baseURL!);
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();

      // Nothing left unfilled, and no other environment's address anywhere in the page.
      expect(html).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
      const named = [...new Set(html.match(/https?:\/\/([a-z0-9-]+\.)*huddle\.fitness/g) ?? [])];
      for (const origin of named) expect([site, app]).toContain(origin);

      const attr = (re: RegExp) => html.match(re)?.[1];
      expect(attr(/<link rel="canonical" href="([^"]*)"/)).toBe(`${site}${path}`);
      expect(attr(/<meta property="og:url" content="([^"]*)"/)).toBe(`${site}${path}`);
      expect(attr(/<meta name="robots" content="([^"]*)"/)).toBe(robots);
    });
  }

  test('the share image is served by this environment, as an image', async ({ request, baseURL }) => {
    const { site } = expectedOrigins(baseURL!);
    for (const path of ['/', '/for-trainers.html', '/pricing.html']) {
      const html = await (await request.get(path)).text();
      const images = [
        ...html.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]*)"/g),
      ].map((m) => m[1]);
      expect(images.length, `${path} declares a share image`).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.startsWith(`${site}/`), `${path}'s ${image} is on ${site}`).toBe(true);
        const res = await request.get(image);
        expect(res.status(), image).toBe(200);
        expect(res.headers()['content-type'], image).toMatch(/^image\//);
      }
    }
  });
});
