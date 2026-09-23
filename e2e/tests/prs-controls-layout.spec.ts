import { expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';

// The PRs board's Record and Sort pickers share ONE row at every iPhone-portrait width.
//
// They used to wrap: each Select put its label beside its field, so "Record [Est. 1RM] ?" plus
// "Sort [Most recent]" was wider than a phone's 327px row and the pair stacked, spending ~100px of
// the screen on two set-and-forget preferences. The labels now sit above the fields, which is what
// buys the width. jsdom computes no layout, so this file is the only thing that can hold that.
//
// Same measurement discipline as trends.spec.ts's weekly-switcher loop, for the same reason: the
// runner's substitute font differs between a Windows dev machine and the Linux CI runner, so the
// tight claim is made under extra letter-spacing rather than at whatever font happens to be there.

const WIDTHS = [320, 375, 390, 393, 402, 430, 768];

// From here up, even the LONGEST sort label ("Best set volume", under the Best set record) is
// asserted whole, under 2px/char of extra letter-spacing. Measured on a Windows runner at that
// spacing: 375px clips it by 22px, 390px by 7px, 430px fits. At 1px/char 375px fits too, so on the
// real devices it is shown whole or near enough -- but the Linux CI runner's substitute font is
// wider than those margins, and asserting them would be asserting the runner's font (trends.spec.ts
// learned that one on lower). Below 430px Sort may ellipsize that one label of a non-default
// pairing, which is graceful; wrapping or overflowing the row is not, and those are asserted at
// every width.
const UNTRUNCATED_MIN_WIDTH = 430;

test.describe('PRs board controls', () => {
  for (const width of WIDTHS) {
    test(`record and sort share one row inside the panel at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await registerHousehold(page, request, 'Nate');
      await pickExercise(page, 'Barbell Bench Press');
      await logSetAt(page, 185, 8);

      await page.getByRole('link', { name: 'PRs' }).click();
      const record = page.getByLabel('Record', { exact: true });
      const sort = page.getByLabel('Sort', { exact: true });
      await expect(record).toBeVisible();

      // The widest combination the board can show: the longest sort label is the value sort under
      // "Best set". Both fields are sized to their widest option anyway, so this is the case the
      // layout budget is really about -- but picking it also makes the truncation check below
      // read the label that would truncate first.
      await record.selectOption('bestSetVolume');
      await sort.selectOption('record');
      await expect(sort).toHaveValue('record');

      if (width >= UNTRUNCATED_MIN_WIDTH) {
        // ~30px across that label, for a wider substitute font. See the header.
        await page.addStyleTag({ content: '.select-value { letter-spacing: 2px !important; }' });
      }

      const recordField = page.locator('.select-field', { has: record });
      const sortField = page.locator('.select-field', { has: sort });
      const recordBox = (await recordField.boundingBox())!;
      const sortBox = (await sortField.boundingBox())!;

      // ONE ROW. Both are 44px fields under a 32px caption, so equal tops is the whole claim.
      expect(Math.round(sortBox.y), `Sort wrapped below Record at ${width}px`).toBe(Math.round(recordBox.y));
      expect(sortBox.x, `Sort overlaps Record at ${width}px`).toBeGreaterThanOrEqual(recordBox.x + recordBox.width);

      // INSIDE THE PANEL'S CONTENT BOX -- not the viewport. A field running into the panel's
      // padding would still be "on screen" while visibly out of line with the search field below.
      const panel = await recordField.evaluate((el) => {
        const p = el.closest('.tab-panel')!;
        const r = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
      });
      expect(recordBox.x, `Record starts left of the panel at ${width}px`).toBeGreaterThanOrEqual(panel.left - 1);
      expect(sortBox.x + sortBox.width, `Sort runs past the panel at ${width}px`).toBeLessThanOrEqual(panel.right + 1);

      // Record never gives way: its longest label is short, and it is the control that decides
      // what every number on the board means.
      const recordClip = await recordField.locator('.select-value-text').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(recordClip, `Record's value is clipped by ${recordClip}px at ${width}px`).toBeLessThanOrEqual(0);

      if (width >= UNTRUNCATED_MIN_WIDTH) {
        const sortClip = await sortField.locator('.select-value-text').evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(sortClip, `Sort's value is clipped by ${sortClip}px at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }
});
