import { test, expect, Page } from '@playwright/test';

// The login screen's animated lockup (frontend/src/components/auth/AnimatedLockup.jsx): the four
// circles walk in to form the huddle above a static wordmark. These pin what jsdom cannot see --
// a real browser's frame loop, the reduced-motion media feature, and hit-testing over the form.
// Its rendered SIZE is brand-lockup-size.spec.ts's job.

// Each circle's resting centre, in the mark's own space (huddleMarkGeometry.js), in paint order.
const RESTING = [
  [34, 36],
  [92, 29],
  [32, 82],
  [84, 80],
];

// `> g > g > circle` reaches the four discs and skips the hairline mask's circle (inside <defs>);
// `fill="none"` is the cream circle's hairline, which tracks the disc and is not a fifth circle.
const circleCentres = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('svg[aria-label="Huddle"] > g > g > circle:not([fill="none"])')].map(
      (c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))],
    ),
  );

const lockup = (page: Page) => page.getByRole('img', { name: 'Huddle', exact: true });

test.describe('login lockup animation', () => {
  test('the circles start away from the huddle, then every one comes to rest in place', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(lockup(page)).toBeVisible();
    // The walk-in is ~2.5s; resting positions are exact once it ends, not merely close.
    await expect.poll(() => circleCentres(page), { timeout: 10_000 }).toEqual(RESTING);
  });

  test('the first frame painted is the start of the walk-in, not the finished logo', async ({
    page,
  }) => {
    // Hold the frame loop so whatever the component drew before its first frame stays on screen.
    // A finished logo here would mean the animation flashes the end state before it plays.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto('/login');
    await expect(lockup(page)).toBeVisible();
    const centres = await circleCentres(page);
    expect(centres).toHaveLength(4);
    centres.forEach(([x, y], i) => {
      expect(Math.hypot(x - RESTING[i][0], y - RESTING[i][1])).toBeGreaterThan(50);
    });
  });

  test('reduced motion shows the finished logo straight away', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await expect(lockup(page)).toBeVisible();
    // No poll: with reduced motion there is nothing to wait for.
    expect(await circleCentres(page)).toEqual(RESTING);
  });

  test('the form is usable while the circles are still walking in', async ({ page }) => {
    await page.goto('/login');
    await expect(lockup(page)).toBeVisible();
    // Circles in flight overflow the logo's box; they must never take a tap meant for the form.
    expect(await lockup(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await page.getByPlaceholder('Email').fill('someone@example.com');
    await page.getByPlaceholder('Password').fill('not-a-real-password');
    await expect(page.getByPlaceholder('Email')).toHaveValue('someone@example.com');
  });
});
