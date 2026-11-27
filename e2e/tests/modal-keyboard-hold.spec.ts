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

type Glide = { found: boolean; duration: number; atStart: number; atMiddle: number };

// Catches the transition that moves a held dialog (the scrim's padding-top) the moment it starts,
// and measures the dialog with the transition held at its start and at its middle (Web Animations
// API), then lets it run on. Independent of the frame rate: a slow runner draws fewer frames of
// the glide, but the transition's own timeline is the same.
async function catchGlide(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __glide: Glide | null };
    w.__glide = null;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const scrim = dialog.parentElement as HTMLElement;
    const onRun = (e: TransitionEvent) => {
      if (e.target !== scrim || e.propertyName !== 'padding-top') return;
      scrim.removeEventListener('transitionrun', onRun);
      const anim = scrim.getAnimations().find((a) => (a as CSSTransition).transitionProperty === 'padding-top');
      if (!anim) {
        w.__glide = { found: false, duration: 0, atStart: 0, atMiddle: 0 };
        return;
      }
      const duration = Number(anim.effect!.getComputedTiming().duration);
      anim.pause();
      const topAt = (t: number) => {
        anim.currentTime = t;
        return Math.round(dialog.getBoundingClientRect().top);
      };
      const atStart = topAt(0);
      const atMiddle = topAt(duration / 2);
      anim.currentTime = 0;
      anim.play();
      w.__glide = { found: true, duration, atStart, atMiddle };
    };
    scrim.addEventListener('transitionrun', onRun);
  });
}

async function readGlide(page: Page): Promise<Glide> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __glide: Glide | null }).__glide !== null), {
      message: 'no padding-top transition carried the move: it jumped',
    })
    .toBe(true);
  return page.evaluate(() => (window as unknown as { __glide: Glide }).__glide);
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

    await catchGlide(page);
    await startSampling(page);
    await page.setViewportSize({ width: PHONE.width, height: keyboardTop });
    const tops = await stopSampling(page);

    expect(tops.length, 'the sampler must have run').toBeGreaterThan(3);
    // It moves up and only up.
    for (let i = 1; i < tops.length; i += 1) {
      expect(tops[i], 'the dialog moved back down while the keyboard opened').toBeLessThanOrEqual(tops[i - 1]);
    }
    const after = tops[tops.length - 1];
    expect(before - after, 'the dialog had to move to clear the keyboard').toBeGreaterThan(0);

    // ...and the whole move is one transition, not a jump. Judged on the transition itself, held at
    // its start and its middle, never by counting frames: how many frames a 280ms glide spans is the
    // runner's frame rate, not the app's. Lower's WebKit runner drew ~25 a second, and one ~110ms
    // frame (the resize itself) carried 157px of a 197px glide that was easing exactly as it should
    // (docs/incidents/2026-11-26-modal-glide-counted-frames-in-webkit.md). The old re-centring had no
    // transition at all and fails at the first line below.
    const glide = await readGlide(page);
    expect(glide.found, 'no padding-top transition carried the move: it jumped').toBe(true);
    expect(glide.duration, 'the glide is a real transition, not an instant one').toBeGreaterThanOrEqual(200);
    expect(
      Math.abs(glide.atStart - before),
      `held at its start the dialog was at ${glide.atStart}, not ${before}: part of the move jumped`,
    ).toBeLessThanOrEqual(1);
    expect(glide.atMiddle, 'halfway through the glide the dialog is on its way up').toBeLessThan(glide.atStart);
    expect(glide.atMiddle, 'halfway through the glide the dialog is not there yet').toBeGreaterThan(after);
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
