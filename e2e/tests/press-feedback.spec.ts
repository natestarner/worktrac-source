import { test, expect, Locator } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// Press feedback is opt-OUT rather than opt-in, and this is the assertion that keeps it that way.
//
// The rule that strips iOS's own tap feedback (`-webkit-tap-highlight-color: transparent`) applies
// to every button in the app; `.pressable`, which replaced it, reached about 40 of ~100. So sixty
// controls acknowledged a tap with nothing at all -- including the exercise chips below, the
// primary tap target of the most-used screen. A replacement for a browser default has to have the
// same reach as the default it replaces.
//
// Only e2e can prove this: jsdom computes no layout and resolves no `:active`, so a unit test
// asserting on a class name would pass just as happily against a rule that never matches.

// Holds the pointer down on a control and runs `check` while it is held, because the transform
// under test exists only for the duration of the press.
//
// The assertion has to POLL rather than read once: the rule carries a --dur-fast transition, so the
// computed transform at the instant the button goes :active is still the identity matrix and only
// reaches scale(0.97) a frame or two later. A single read here returns "matrix(1, 0, 0, 1, 0, 0)"
// against a perfectly working rule.
async function whilePressed(locator: Locator, check: () => Promise<void>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('control is not visible, so it cannot be pressed');
  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await check();
  } finally {
    await page.mouse.up();
  }
}

// getComputedStyle resolves `scale(0.97)` to a matrix, so this is the x-scale component.
function computedTransform(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).transform);
}

test.describe('Press feedback', () => {
  test('every button answers a press, whether or not it carries .pressable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Press');

    // A control that does NOT carry .pressable. This is the case that had no feedback at all: a
    // raw <button> in ExercisePicker, and the first thing anyone taps on the busiest screen.
    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    const chip = page.getByRole('button', { name: 'Barbell Bench Press' }).first();
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((el) => el.classList.contains('pressable'))).toBe(false);

    await whilePressed(chip, async () => {
      await expect
        .poll(() => computedTransform(chip), {
          message: 'the chip painted no press transform while held down',
        })
        .toContain('0.97');
    });

    // At rest it must go back to nothing, or the control is permanently shrunk rather than
    // responding to a press.
    await expect.poll(() => computedTransform(chip)).toBe('none');
  });

  test('the 300ms double-tap-zoom delay is off, and labels do not select on a long press', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Touch');

    const addOwn = page.getByRole('button', { name: '+ Add your own exercise' });
    await expect(addOwn).toBeVisible();

    const styles = await addOwn.evaluate((el) => {
      const s = getComputedStyle(el);
      return { touchAction: s.touchAction, userSelect: s.userSelect || s.webkitUserSelect };
    });

    // Without this, Safari spends ~300ms deciding whether a tap is half of a double-tap zoom --
    // sitting in front of the most repeated action in the app.
    expect(styles.touchAction).toBe('manipulation');
    // A long press one-handed on an iPad otherwise starts selecting the button's own label.
    expect(styles.userSelect).toBe('none');
  });

  // The rule above is global, but it was only ever asserted on a picker button -- and the control
  // it matters most for is the stepper, which is now genuinely HELD down rather than tapped
  // (hooks/useHoldRepeat.js). A callout bubble or a selection appearing mid-hold would cover the
  // number being changed.
  test('the stepper buttons survive being held down', async ({ page, request }) => {
    await registerHousehold(page, request, 'Holder');
    await pickExercise(page, 'Barbell Bench Press');

    const styles = await page.getByTitle('Increase Weight (lb)').evaluate((el) => {
      const s = getComputedStyle(el);
      return { touchAction: s.touchAction, userSelect: s.userSelect || s.webkitUserSelect };
    });

    // Deliberately still `manipulation`, not `none`. A scroll gesture that happens to start on a
    // 44px stepper button should still pan the page -- the browser classifies the pan long before
    // the 500ms hold delay, so it steps nothing.
    expect(styles.touchAction).toBe('manipulation');
    expect(styles.userSelect).toBe('none');
    // `-webkit-touch-callout: none` is set alongside these in index.css and is the third thing a
    // held button needs, but it CANNOT be asserted here: Chromium does not implement the property
    // at all, so getComputedStyle reports `undefined` rather than a value. It is a Safari/iOS
    // behaviour with no coverage available in this browser -- verify it on a device.
  });
});
