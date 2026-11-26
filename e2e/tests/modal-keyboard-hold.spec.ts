import { test, expect, Page, Locator } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine } from './support/exercises';

// A dialog must not jump when the keyboard opens, or when its own content grows (TestFlight, 1.4:
// New exercise, New routine and the rest visibly leapt as a field was tapped on iPhone and iPad).
//
// Why they jumped: Modal centred its panel in a scrim sized to the VISIBLE viewport. In the App
// Store app the keyboard shrinks the whole WebView (`Keyboard.resize: "native"`), so the scrim
// shrank, the centre moved up, and the panel leapt by half the keyboard's height. Modal now centres
// once, at open, and holds that spot; it moves only when the panel would no longer fit, and then as
// one transition.
//
// No browser here opens a software keyboard. The app's shape is the window shrinking, which
// setViewportSize reproduces (keyboard-scroll.spec.ts does the same). What only a device can show:
// the real keyboard's timing against the transition, and Safari's own pan of the page.

const PHONE = { width: 390, height: 844 };

// The dialog's entrance animation holds it off its resting box until it finishes (e2e-tests.md).
async function dialogSettled(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.evaluate((el) => el.getAnimations().length === 0 && getComputedStyle(el).transform === 'none'),
    )
    .toBe(true);
}

// Samples the dialog's top on every animation frame until stopped. A retrying matcher would wait
// out a jump; samples cannot.
async function startSampling(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __tops: number[]; __sampling: boolean };
    w.__tops = [];
    w.__sampling = true;
    const sample = () => {
      const el = document.querySelector('[role="dialog"]');
      if (el) w.__tops.push(Math.round(el.getBoundingClientRect().top));
      if (w.__sampling) requestAnimationFrame(sample);
    };
    sample();
  });
}

async function stopSampling(page: Page): Promise<number[]> {
  // A few more frames first, for a transition the change set off.
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const w = window as unknown as { __tops: number[]; __sampling: boolean };
    w.__sampling = false;
    return w.__tops;
  });
}

async function openAddPerson(page: Page) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  const dialog = page.getByRole('dialog');
  await dialogSettled(dialog);
  await expect(page.getByPlaceholder('Name', { exact: true })).toBeFocused();
  return dialog;
}

test.describe('a dialog holds still when the keyboard opens', () => {
  test('a short dialog does not move at all while it still fits above the keyboard', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.setViewportSize(PHONE);
    const dialog = await openAddPerson(page);
    const before = Math.round((await dialog.boundingBox())!.y);

    await startSampling(page);
    // The keyboard arrives: the app's window ends at its top edge.
    await page.setViewportSize({ width: PHONE.width, height: 560 });
    const tops = await stopSampling(page);

    // Centred, it would have risen by half of 284px on this very frame. Held, it never moves.
    expect(tops.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const top of tops) expect(top, `the dialog moved, to ${top} from ${before}`).toBe(before);
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height, 'the dialog fits above the keyboard').toBeLessThanOrEqual(560);

    // ...and the keyboard going away leaves it where it is too.
    await startSampling(page);
    await page.setViewportSize(PHONE);
    for (const top of await stopSampling(page)) expect(top).toBe(before);
  });

  test('a dialog the keyboard would cover glides up just far enough, never jumps', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.setViewportSize(PHONE);
    const dialog = await openAddPerson(page);
    const before = Math.round((await dialog.boundingBox())!.y);
    const height = Math.round((await dialog.boundingBox())!.height);

    const keyboardTop = 360;
    expect(before + height, 'the setup must put the dialog under the keyboard').toBeGreaterThan(keyboardTop);

    await startSampling(page);
    await page.setViewportSize({ width: PHONE.width, height: keyboardTop });
    const tops = await stopSampling(page);

    expect(tops.length, 'the sampler must have run').toBeGreaterThan(3);
    // It moves up and only up, spread over many frames: the old re-centring moved the whole way on
    // one frame. (Measured locally: 310 -> 112 over ~15 frames, the largest step 41px of 198.)
    let largestStep = 0;
    let movingFrames = 0;
    for (let i = 1; i < tops.length; i += 1) {
      expect(tops[i], 'the dialog moved back down while the keyboard opened').toBeLessThanOrEqual(tops[i - 1]);
      const step = tops[i - 1] - tops[i];
      largestStep = Math.max(largestStep, step);
      if (step > 0) movingFrames += 1;
    }
    const travel = tops[0] - tops[tops.length - 1];
    expect(travel, 'the dialog had to move to clear the keyboard').toBeGreaterThan(0);
    expect(movingFrames, `the dialog arrived in ${movingFrames} frame(s), not a glide`).toBeGreaterThanOrEqual(5);
    expect(largestStep, `one frame carried ${largestStep}px of a ${travel}px move`).toBeLessThanOrEqual(travel / 3);
    // It ends fully above the keyboard, and below the top inset.
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(23);
    expect(box.y + box.height).toBeLessThanOrEqual(keyboardTop + 1);
    await expect(page.getByPlaceholder('Name', { exact: true })).toBeInViewport();
  });

  test('a dialog whose content grows grows downward, its top held', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();
    const dialog = page.getByRole('dialog');
    await dialogSettled(dialog);
    const before = Math.round((await dialog.boundingBox())!.y);
    const heightBefore = Math.round((await dialog.boundingBox())!.height);

    await startSampling(page);
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    const tops = await stopSampling(page);

    // Centred, the top rose by half of whatever the list added. Held, it stays put.
    expect(Math.round((await dialog.boundingBox())!.height), 'the content must actually have grown').toBeGreaterThan(
      heightBefore,
    );
    expect(tops.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const top of tops) expect(top, `the dialog moved, to ${top} from ${before}`).toBe(before);
  });
});
