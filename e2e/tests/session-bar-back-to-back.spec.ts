import { Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, pickExercise, tapLogSet } from './support/exercises';
import { API_ONLY, delayNetwork } from './support/faults';

// Ending one workout and starting the next straight away (2026-11-25). The End is still on its way
// to the server, so a live-session read that left before it landed comes back naming the workout
// just ended. That answer used to replace the new workout's placeholder: the session bar vanished
// for a round trip, and an "End this workout?" sheet open at that moment closed itself (lower's
// nightly "Just me" flake in parity-session-recap, both engines). lib/liveSession.js now treats an
// ended id like "none" while a set is queued; liveSession.test.js pins the rule.
//
// Lower's ~750ms round trips are what open the window; locally a ~5ms one never does, so the API is
// delayed here. Red 6/6 against the old fetchLiveSession, green 10/10 with the fix. The claim is
// "the bar is never absent", which a retrying matcher cannot express (it would wait the blink out),
// so every animation frame is sampled.
async function sampleBar(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __barSamples: boolean[]; __barStop: boolean };
    w.__barSamples = [];
    w.__barStop = false;
    const tick = () => {
      if (w.__barStop) return;
      w.__barSamples.push(!!document.body.textContent?.includes('Session in progress'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(page: Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __barSamples: boolean[]; __barStop: boolean };
    w.__barStop = true;
    return w.__barSamples;
  });
}

test('the session bar stays up when the next workout starts while the last one is still ending', async ({ page, request }) => {
  await registerHousehold(page, request, 'BackToBack');
  await delayNetwork(page, API_ONLY, 750);
  const done = page.getByRole('dialog', { name: 'Workout done' });

  await pickExercise(page, 'Barbell Bench Press');
  await tapLogSet(page);
  await dismissPrCelebration(page);
  await expect(page.getByText('Set 1')).toBeVisible();
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('dialog', { name: 'End this workout?' }).getByRole('button', { name: 'End workout' }).click();
  await done.getByRole('button', { name: 'Just me' }).click();
  await expect(done).toBeHidden();

  // Straight into the next workout, with the End still in flight.
  await pickExercise(page, 'Barbell Bench Press');
  await tapLogSet(page);
  await expect(page.getByText('Session in progress', { exact: false })).toBeVisible();
  await sampleBar(page);
  await dismissPrCelebration(page);
  await expect(page.getByText('Set 1')).toBeVisible();
  // Long enough for every read that left before the End landed to answer, and the set's own.
  await page.waitForTimeout(4000);
  const samples = await stopSampling(page);

  expect(samples.length, 'the sampler must have watched some frames').toBeGreaterThan(10);
  expect(samples.filter((shown) => !shown).length, 'frames with no session bar mid-workout').toBe(0);

  // And the sheet it hosts stays open until the person answers it.
  const asking = page.getByRole('dialog', { name: 'End this workout?' });
  await page.getByRole('button', { name: 'End workout' }).click();
  await expect(asking).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(asking).toBeVisible();
});
