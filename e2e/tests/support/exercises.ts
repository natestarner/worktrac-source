import { Page, expect } from '@playwright/test';

// After the favorites redesign, a newly-registered person's Log picker is empty (it only shows
// their favorites and previously-logged exercises). Selecting an exercise for the first time
// means searching the catalog, then tapping the result chip. Works whether or not the exercise
// is already in the person's list.
export async function pickExercise(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

// The routine builder's "Add exercise to routine" pool likewise defaults to favorites/logged,
// so search the catalog, then tap the result row (search results render as a plain-name list,
// same as the Log picker -- the "+ Name" chip styling only applies to the default
// favorites/logged view, not search results).
export async function addExerciseToRoutine(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

// The exercise screen's one big button, whatever it reads: "Log set" (or "Log set for Sam"), or
// "Enter a weight" on the first set of an exercise that expects one. For "is the exercise screen
// open?" checks; tap it with tapLogSet.
export function logSetButton(page: Page) {
  return page.getByRole('button', { name: /^(Log set|Enter a weight)/ });
}

// Taps Log set for whatever is on screen, the way every spec did before load types (2026-11-24).
//
// A person's FIRST set of an exercise that expects a weight (load_type 'external', e.g. Barbell
// Back Squat) now asks for one: Log set is disabled and reads "Enter a weight". A blank used to log
// 0, a bodyweight set, so a spec that tapped Log set there meant exactly that -- and typing 0, as
// the hint under the button says ("Enter 0 for bodyweight"), still logs it. Anywhere else this is
// just the tap.
//
// ⚠️ It waits for the summary cards first ("Last time"), because that is when the screen KNOWS
// whether there is history: before then nothing is asked (ExerciseDetail's `prefill != null`), so
// an earlier check would see an enabled button that then flips.
export async function tapLogSet(page: Page) {
  await expect(page.getByText(/^Last time/).first()).toBeVisible();
  const asking = page.getByRole('button', { name: 'Enter a weight' });
  const weight = page.getByRole('textbox', { name: /^Weight \(/ });
  const logSet = page.getByRole('button', { name: /^Log set/ });
  // Polled, not checked once: on a just-created exercise under lie-fi the cards can draw a beat
  // before the device's History answers, and only then does the screen know to ask.
  await expect
    .poll(async () => {
      if (await asking.isVisible()) {
        await weight.fill('0');
        await weight.press('Enter');
      }
      return (await logSet.count()) > 0 && (await logSet.first().isEnabled());
    })
    .toBe(true);
  await logSet.first().click();
}

// Back to the Log picker from an exercise's detail screen. NOT the "Log" tab link: routing to
// /app/log is a no-op when you are already there, and the picker only renders while
// `selectedExerciseId` is null -- so the tab link leaves you on the exercise you were already on.
export async function backToPicker(page: Page) {
  await page.getByRole('button', { name: /All exercises/ }).click();
  await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
}

// Create a custom exercise via the always-present "+ Add your own exercise" button (on the Log
// picker or the routine modal). Creating it auto-favorites it and opens its detail screen.
export async function addOwnExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  // The modal has a setup-field "Add" chip button and the submit "Add" button; submit is last.
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
}

// 'Time' is the second stepper for a duration-tracked exercise (a plank), where it replaces
// 'Reps'. It does not collide with the .stepper-row text filter below: no row's label contains
// another's.
export type StepperLabel = 'Weight' | 'Reps' | 'Time';

// Weight/reps are steppers with a real <input> for the value (it selects its text on focus, so
// typing replaces the prefill instead of appending to it -- see WeightRepsStepper.jsx). `fill`
// overwrites the whole value directly regardless of that, so it's just fill + commit; the input
// commits on blur/Enter, not on every keystroke, hence the trailing `press('Enter')`. Wrapped in
// expect.poll because ExerciseDetail's computePrefillDraft effect re-seeds the draft when the
// summary / session-sets queries settle, which can land after this and stomp the value -- the
// same race offline-reads.spec.ts's setWeight documents.
// The weight row is "Weight (lb)" on a Weight & reps exercise and "Added (lb)" on a bodyweight one
// (utils/exerciseLoad.js#weightLabel); both are the Weight stepper.
function stepperRow(page: Page, label: StepperLabel) {
  return page.locator('.stepper-row').filter({ hasText: label === 'Weight' ? /^(Weight|Added) \(/ : label });
}

export async function setStepper(page: Page, label: StepperLabel, target: number) {
  const value = stepperRow(page, label).locator('.stepper-value');

  await expect
    .poll(
      async () => {
        if (Number(await value.inputValue()) === target) return target;
        await value.fill(String(target));
        await value.press('Enter');
        return Number(await value.inputValue());
      },
      { timeout: 20000 },
    )
    .toBe(target);
}

function stepperValue(page: Page, label: StepperLabel) {
  return stepperRow(page, label).locator('.stepper-value');
}

// Sets BOTH steppers, then re-checks them together.
//
// setStepper on its own is not enough. It polls until the value it typed reads back, but
// computePrefillDraft re-seeds the draft whenever the summary / session-sets queries settle, and
// that can land *after* the poll succeeded and *before* the "Log set" click. Locally those queries
// return in milliseconds so the race is almost never lost; against a deployed backend it is, and
// the set is silently logged at the 45 lb prefill default instead of the target.
//
// Re-verifying the pair after both are set is what closes the window that matters: a re-seed
// stomps BOTH fields, so checking reps also catches a stomped weight.
export async function setStepperPair(page: Page, weight: number, reps: number) {
  await expect
    .poll(
      async () => {
        if (Number(await stepperValue(page, 'Weight').inputValue()) !== weight) {
          await setStepper(page, 'Weight', weight);
        }
        if (Number(await stepperValue(page, 'Reps').inputValue()) !== reps) {
          await setStepper(page, 'Reps', reps);
        }
        const w = await stepperValue(page, 'Weight').inputValue();
        const r = await stepperValue(page, 'Reps').inputValue();
        return `${Number(w)}x${Number(r)}`;
      },
      { timeout: 30000 },
    )
    .toBe(`${weight}x${reps}`);
}

// The celebration card, whichever headline it carries: "New PR!" for a record, or the quiet
// "First Barbell Bench Press" a first-ever set gets when the server has confirmed it really is the
// first (prDetection.js#isCertainFirstEver). Which one a brand-new exercise's first set shows
// depends on whether its summary had landed before the tap -- a spec that taps straight after
// pickExercise can get either, and both are correct. Use this wherever a spec only needs "the card
// is up / dismiss it"; assert getByText('New PR!') only where the set is a genuine record (it beats
// an earlier set), and getByRole('dialog', { name: 'First …' }) only after waiting for the summary.
export function prCelebration(page: Page) {
  return page.locator('[role="dialog"][aria-labelledby="pr-celebration-title"]');
}

// Dismisses the PR celebration if one is on screen, and does nothing if not.
//
// NEEDED AFTER EVERY BARE "Log set" CLICK. The overlay is a full-viewport fixed scrim, so while
// it is up every subsequent click is intercepted. It used to clear itself after 2800ms, which
// meant Playwright's actionability auto-wait simply waited it out and no spec had to think about
// it; it now persists until dismissed (a record set mid-conversation should not be missed), so a
// spec that logs a PR and then clicks anything else will hang until timeout instead.
//
// The isVisible() check is NOT a race, and that is a property of the redesign rather than luck:
// PR detection is client-side and runs at dispatch, so if a record fell the overlay is already
// rendered by the time click() resolves. Back when it waited on the log-set response, this exact
// helper would have been flaky.
//
// Either card: the full "New PR!" or the quiet "First <exercise>" a confirmed first-ever set gets
// (prCelebration below).
export async function dismissPrCelebration(page: Page) {
  const celebration = prCelebration(page);
  if (await celebration.isVisible()) {
    await celebration.click({ force: true });
    await expect(celebration).toBeHidden();
  }
}

// Ends the active person's workout through the bar and its "End this workout?" sheet, then closes
// the sheet if it stays open to ask "Who else trains with you?".
//
// USE THIS RATHER THAN CLICKING "End workout" TWICE. The sheet is a Modal, so until it closes every
// click on the page behind it is intercepted -- the same trap as the PR celebration above. After
// the End it either closes, or (a one-person household that hasn't answered "Just me") stays open
// retitled "Workout done". The End tap renders either outcome in the same commit, so once the
// "End this workout?" title is gone, whether the "Workout done" one is there is already settled.
export async function endWorkout(page: Page) {
  await page.getByRole('button', { name: 'End workout' }).first().click();
  const asking = page.getByRole('dialog', { name: 'End this workout?' });
  await asking.getByRole('button', { name: 'End workout' }).click();
  await expect(asking).toBeHidden();
  const done = page.getByRole('dialog', { name: 'Workout done' });
  if (await done.isVisible()) {
    // The X, which closes it without answering the question.
    await done.getByRole('button', { name: 'Close' }).click();
    await expect(done).toBeHidden();
  }
}

// Logs one set at an exact weight/reps. Every caller so far logs strictly increasing bests, so a
// celebration (the first-time card, then "New PR!") fires each time and must be dismissed before the next set can be logged.
//
// Use this rather than driving setStepper yourself -- see setStepperPair above for why, and note
// the failure mode is remote from the cause: a 315x2 logged as 45x2 is no longer a PR, so what you
// actually see is a missing celebration or a records/sort assertion reading a number nobody typed.
export async function logSetAt(page: Page, weight: number, reps: number) {
  const setRows = page.getByText(/^Set \d+$/);
  const rowsBefore = await setRows.count();

  await setStepperPair(page, weight, reps);
  await page.getByRole('button', { name: 'Log set' }).click();

  // The first set of a new exercise may get the quiet first-time card rather than "New PR!".
  const celebration = prCelebration(page);
  await expect(celebration).toBeVisible();
  await celebration.click({ force: true });
  await expect(celebration).toBeHidden();

  // Wait for this set's own row before returning, so the prefill re-seed that THIS write triggers
  // has already fired by the time the next call starts typing -- otherwise the race just moves to
  // the following set.
  await expect(setRows).toHaveCount(rowsBefore + 1);
}


// The Time stepper shows m:ss in both states. Tapping it opens the min/sec wheel
// (DurationWheel) rather than a keyboard, because a phone's numeric keypad has no colon key --
// which is the whole reason the picker exists. The field itself stays a real <input>, read-only,
// so `inputValue()` still reads the committed value back; only `fill()` no longer applies.
function asClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Drives the wheel by DIGIT TYPEAHEAD, not by scrolling and not by N arrow presses. Scroll-driving
// a scroll-snap container from Playwright means racing momentum and snap physics for a value we
// then have to read back -- inherently flaky, and slow. Typing "4" "5" into the seconds column is
// one deterministic step, and it exercises the same keyboard interface that answers the
// "unrequested overlay over a mouse-and-keyboard session" objection in the app itself.
export async function setHoldSeconds(page: Page, target: number) {
  const value = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
  const expected = asClock(target);

  await expect
    .poll(
      async () => {
        if ((await value.inputValue()) === expected) return expected;

        await value.click();
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible();

        // Both columns every time, including a zero: the wheel keeps whatever the field already
        // held, so leaving a column untouched leaves the PREVIOUS set's minutes in place.
        for (const [name, digits] of [
          ['Minutes', String(Math.floor(target / 60))],
          ['Seconds', String(target % 60)],
        ] as const) {
          const column = sheet.getByRole('listbox', { name });
          // focus(), not click(): the column's centre is an option row, and clicking it would
          // select whatever happens to be sitting in the selection band. Focusing also blurs the
          // other column, which resets its typeahead buffer -- so these digits mean the same
          // thing on a retry as they did on the first attempt.
          await column.focus();
          for (const digit of digits) await column.press(digit);
        }

        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
        return value.inputValue();
      },
      { timeout: 20000 },
    )
    .toBe(expected);
}

// logSetAt's counterpart for a duration-tracked exercise: logs one hold at an exact number of
// seconds. Kept separate rather than overloading logSetAt because the two take different measures
// and the PR celebration copy differs -- a hold has no est. 1RM.
export async function logHoldAt(page: Page, seconds: number, { expectPr = true }: { expectPr?: boolean } = {}) {
  const setRows = page.getByText(/^Set \d+$/);
  const rowsBefore = await setRows.count();

  await setHoldSeconds(page, seconds);
  await page.getByRole('button', { name: 'Log set' }).click();

  if (expectPr) {
    const celebration = prCelebration(page);
    await expect(celebration).toBeVisible();
    await celebration.click({ force: true });
    await expect(celebration).toBeHidden();
  }

  await expect(setRows).toHaveCount(rowsBefore + 1);
}

// Creates a household exercise measured in TIME rather than reps, via the same
// "+ Add your own exercise" flow as addOwnExercise plus the Reps/Time toggle.
export async function addOwnTimedExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  await page.getByRole('dialog').getByRole('radio', { name: 'Time', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
}

// The duplicate path through the SAME modal: when the typed name and measure already exist, the
// primary button becomes "Open <name>" and no exercise is created. Deliberately a separate helper
// rather than a flag on addOwnExercise -- a spec asserting the duplicate behaviour should fail
// loudly if the button never changed, instead of silently falling back to creating a second row.
export async function openExistingViaAddOwn(page: Page, name: string, measure: 'Reps' | 'Time' = 'Reps') {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  // "Measured in" offers Weight & reps / Bodyweight / Time; a rep exercise is the first (the
  // default, and the same movement family as Bodyweight for the duplicate check).
  const option = measure === 'Time' ? 'Time' : 'Weight & reps';
  await page.getByRole('dialog').getByRole('radio', { name: option, exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: `Open ${name}`, exact: true }).click();
}
