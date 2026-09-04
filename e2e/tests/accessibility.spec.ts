import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// The suite had 51 specs and asserted nothing at all about accessibility, so a whole class of
// defect was structurally invisible -- the same shape of gap the screenshot audit found for
// visual ones. axe cannot judge whether a label reads well, but it does catch the mechanical
// half: missing landmarks, unlabelled controls, contrast below AA, broken heading order.
//
// Scoped to wcag2a/wcag2aa/wcag21a/wcag21aa, which is the bar this app already claims to meet --
// docs/architecture/design-system.md computes a contrast ratio for every colour token and cites
// AA throughout. This makes that claim testable rather than asserted.
//
// NOT a "zero violations everywhere" gate. It runs on the screens someone actually uses, and any
// exclusion below carries its reason, so a future reader can tell a deliberate exemption from a
// forgotten one.
async function analyze(page: Page) {
  return new AxeBuilder({ page })
    // 'best-practice' is included deliberately, not just the WCAG tags. The three things this
    // suite actually found -- no <main>, no <h1>, six regions outside any landmark -- are ALL
    // best-practice rules rather than WCAG A/AA failures. Scoping to WCAG alone would have
    // reported a clean sheet on an app a screen reader could not navigate.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
}

function summarize(results: Awaited<ReturnType<typeof analyze>>) {
  return results.violations
    .map((v) => `${v.impact ?? 'unknown'} :: ${v.id} :: ${v.nodes.length} node(s) :: ${v.help}`)
    .join('\n');
}

test.describe('Accessibility baseline', () => {
  test('the sign-in screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

    const results = await analyze(page);
    expect(summarize(results), summarize(results)).toBe('');
  });

  test('the Log screen, which is where the time is spent', async ({ page, request }) => {
    await registerHousehold(page, request, 'Ada');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    const results = await analyze(page);
    expect(summarize(results), summarize(results)).toBe('');
  });

  test('the other tabs', async ({ page, request }) => {
    await registerHousehold(page, request, 'Grace');

    for (const tab of ['History', 'PRs', 'Routines', 'Trends'] as const) {
      await page.getByRole('link', { name: tab }).click();
      await expect(page.getByRole('link', { name: tab })).toBeVisible();
      const results = await analyze(page);
      expect(summarize(results), `${tab}\n${summarize(results)}`).toBe('');
    }
  });

  // axe does NOT flag a duplicate <h1> -- `page-has-heading-one` only requires at least one, and
  // HTML5 permits several inside sectioning content. So the check above returned a clean sheet on
  // the Handbook while the shell was rendering a hidden "Huddle Handbook" heading directly above
  // that screen's own visible one, announced twice by a screen reader. It reached lower, where the
  // two Handbook specs caught it on `strict mode violation ... resolved to 2 elements`.
  //
  // Asserting the count here makes the whole class visible rather than relying on some unrelated
  // spec happening to select a heading by role. The Handbook is listed explicitly because it is
  // the only screen that draws its own h1, and therefore the only one where the shell has to
  // render nothing.
  // The skip link is `position: absolute` and parked off-screen until focused. It was parked at a
  // FIXED offset (top: -40px) while measuring 45.5px tall, so 5.5px of a rounded, bordered,
  // shadowed box sat permanently above the header -- reported as "an odd line/shape right above
  // the logo". axe cannot see this: the element is present, labelled and reachable, which is all
  // it checks. Only geometry catches it, and jsdom computes no layout, so this has to be e2e.
  //
  // Asserted as "fully above the viewport", not "-57.5px", so it survives any change to the
  // font, padding or string length -- pinning the exact number would just relocate the brittleness
  // that caused the bug.
  test('the skip link is fully off-screen until focused, then fully on', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Curie');

    const skip = page.locator('.skip-link');
    const parked = await skip.boundingBox();
    expect(parked, 'the skip link should be in the layout, just off-screen').not.toBeNull();
    expect(
      parked!.y + parked!.height,
      'no part of the skip link may be visible while unfocused',
    ).toBeLessThanOrEqual(0);

    // Tab from the document start: the skip link is deliberately the first thing focus reaches.
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();

    // Polled, not sampled once -- the reveal is a transform transition, so a single boundingBox
    // read straight after the keypress catches it mid-flight (it returned -11.95 on the first cut
    // of this test). Polling asserts where it comes to REST, which is the actual claim.
    await expect
      .poll(async () => (await skip.boundingBox())?.y ?? -1, {
        message: 'focusing it must bring the whole control on screen',
      })
      .toBeGreaterThanOrEqual(0);
  });

  test('every screen has exactly one h1', async ({ page, request }) => {
    await registerHousehold(page, request, 'Hopper');

    const screens = [
      ['Log', '/app/log'],
      ['History', '/app/history'],
      ['PRs', '/app/prs'],
      ['Routines', '/app/routines'],
      ['Trends', '/app/trends'],
      ['App settings', '/app/settings'],
      ['Handbook', '/app/help'],
      ['Contact us', '/app/contact'],
    ] as const;

    for (const [name, path] of screens) {
      await page.goto(path);
      await expect(page.locator('main#main-content')).toBeVisible();
      await expect(page.locator('h1'), `${name} (${path}) should have exactly one h1`).toHaveCount(
        1,
      );
    }
  });
});
