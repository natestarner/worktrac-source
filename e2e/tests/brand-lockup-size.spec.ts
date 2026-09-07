import { test, expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';

// The Huddle lockup renders at a size nothing in CSS states outright: the <img> pins ONE axis
// (the header pins height, the auth screens pin width) and the SVG's own viewBox decides the
// other. That makes the asset file part of the layout contract, and it is the half no reviewer
// looks at.
//
// The brand v3 lockups ship with the clear space baked into their canvas -- 48.64 units of a
// 200-unit box vertically, against the previous assets' 24 of 155. Dropped in unchanged they
// would have rendered the mark ~15% smaller inside a taller box, so `frontend/src/assets/`'s
// copies carry a viewBox retightened to the brand-minimum clear space (the orange circle's
// radius, 32.64 lockup units). `docs/brand/README.md` has the derivation.
//
// Re-exporting those files from the kit's own canvas is the obvious "cleanup" and it silently
// resizes the header. This spec is what catches that: it measures rendered pixels, which is the
// only place the crop is observable -- jsdom computes no layout, and neither the CSS nor the JSX
// changes when the asset does.
//
// Both schemes are measured because the lockup is a <picture> with a prefers-color-scheme
// <source>: light and dark are two different FILES, so a crop applied to one and not the other
// is a real and otherwise invisible failure mode.

const logo = (page: Page) => page.locator('img[alt="Huddle"]');

// ⚠️ Measure only once the image has actually LAID OUT, never straight after navigation.
//
// `boundingBox()` does not wait for an image to decode -- it returns whatever the box is at that
// instant, and for an <img> whose height comes from the SVG's own viewBox that is legitimately
// `0` until the file is decoded. Under full-suite load this loses often enough to matter: it has
// twice produced `Expected: 201.9, Received: 0`, which reads exactly like an asset-crop regression
// (the failure this whole spec exists to catch) and is nothing of the kind.
//
// Polling on the box itself rather than on `complete`/`naturalWidth` is deliberate: layout is what
// the assertions below are about, and a decoded image whose box has not been computed yet would
// still measure zero.
async function laidOutLogo(page: Page) {
  const img = logo(page);
  await expect.poll(async () => (await img.boundingBox())?.height ?? 0).toBeGreaterThan(0);
  return (await img.boundingBox())!;
}

// Measured against the pre-v3 assets, which is the baseline this change promised not to move.
// Width is the derived axis in the header, so it gets the looser bound.
const HEADER_HEIGHT = 52;
const HEADER_WIDTH = 141.1;
const AUTH_HEIGHT = 201.9;
const AUTH_WIDTH = 216;

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`brand lockup geometry (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('the auth screen lockup keeps the vertical space it always occupied', async ({ page }) => {
      await page.goto('/login');
      const box = await laidOutLogo(page);

      // Height is what matters here: it decides where the form below the logo starts. The old
      // asset rendered a 199.8px-tall box from width 445 (its ink was only 122x148 -- the file
      // was mostly empty canvas); the v3 vertical lockup reaches the same ink height from
      // width 216.
      expect(box.height).toBeCloseTo(AUTH_HEIGHT, 0);
      expect(box.width).toBeCloseTo(AUTH_WIDTH, 0);
    });

    test('the header lockup is exactly as tall as it was before brand v3', async ({
      page,
      request,
    }) => {
      await registerHousehold(page, request, 'Alex');
      const box = await laidOutLogo(page);

      // The height is pinned in Header.jsx and must not drift; the width follows from the
      // asset's aspect ratio, so it is the number that moves if someone restores the kit's
      // uncropped canvas (462x200 would render ~120px wide at this height).
      expect(box.height).toBeCloseTo(HEADER_HEIGHT, 0);
      expect(box.width).toBeCloseTo(HEADER_WIDTH, 0);
    });
  });
}
