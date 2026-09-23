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
// Every claim here holds whatever the runner's font is. That is deliberate, and it was learned on
// lower: a first version also asserted that the LONGEST sort label ("Best set volume") was shown
// whole from 430px up, under 2px/char of extra letter-spacing -- the trends.spec.ts recipe. It
// passed on a Windows dev machine and failed on the Linux CI runner, clipped by 15px AT 430px. The
// app's font stack falls through to a different substitute on every non-Apple platform, so "does
// this label fit" has no runner-independent answer at ANY width here, only a font-dependent one.
// What stays true on every font is structural: one row, inside the panel, Record never gives way
// (it is sized to its widest option and never shrinks), and when Sort does give way it ellipsizes
// rather than clipping mid-letter.

const WIDTHS = [320, 375, 390, 393, 402, 430, 768];

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
      // layout budget is really about -- and it is the label that ellipsizes first when Sort has
      // to give way.
      await record.selectOption('bestSetVolume');
      await sort.selectOption('record');
      await expect(sort).toHaveValue('record');

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

      // Sort MAY give way on a narrow phone or a wide font -- but as an ellipsis, never a label cut
      // off mid-letter, which is what a native <select> does in WebKit and half of why the field is
      // drawn at all.
      const sortOverflow = await sortField
        .locator('.select-value-text')
        .evaluate((el) => ({ textOverflow: getComputedStyle(el).textOverflow, overflow: getComputedStyle(el).overflowX }));
      expect(sortOverflow, `Sort's value would clip instead of ellipsizing at ${width}px`).toEqual({
        textOverflow: 'ellipsis',
        overflow: 'hidden',
      });
    });
  }
});
