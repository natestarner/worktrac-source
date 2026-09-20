import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, logSetAt as logSet } from './support/exercises';

// Covers the Trends analytics expansion: the consistency heatmap, the weekly metric switcher
// (volume/sets/reps), the per-exercise metric switcher, and the all-time records table.
//
// Two locator hazards on this screen, both hit while writing this file:
//   1. An exercise name now appears in the Log picker, History, the PRs board, the Trends
//      dropdown AND the exercise section header. Everything here goes through a role + name or
//      a scoped container, never a bare name lookup.
//   2. getByText is case-insensitive substring matching, so the records row "Total reps" also
//      matches the section header "Exercise progress · total reps" once that metric is selected
//      (same for "Heaviest weight" / "· heaviest weight"). Every records-row lookup passes
//      exact: true for that reason -- dropping it reintroduces a strict-mode violation.

// The header's account-holder dropdown trigger shows the primary person's name too, so scope
// person switching to the pill row (see multi-person.spec.ts's identical note).
function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

function recordRow(page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

// The narrowest viewport at which the weekly switcher's four pills are asserted to share one line.
// 375px is the narrowest iPhone portrait width Apple still ships (SE 3rd gen, 13 mini); 320px is
// the 2016 SE/iPhone 5, and the margin there is thinner than the difference between two platforms'
// substitute fonts. See the long note in the loop below.
const ONE_LINE_MIN_WIDTH = 375;

test.describe('Trends analytics', () => {
  test('heatmap, metric switchers and records table all render real data', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // 225x1 is the top weight but 185x8 is the better estimated 1RM and the better set volume.
    // That divergence is the entire reason the metric switcher and the records table exist.
    await pickExercise(page, 'Barbell Bench Press');
    await logSet(page, 135, 10);
    await logSet(page, 225, 1);
    await logSet(page, 185, 8);

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page).toHaveURL(/\/app\/trends/);

    // --- Consistency heatmap ---
    await expect(page.getByTestId('consistency-grid')).toBeVisible();
    await expect(page.getByText('1 active day')).toBeVisible();

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayCell = page.getByTestId(`heat-${todayKey}`);
    await expect(todayCell).toHaveAttribute('data-level', '1'); // 3 sets -> level 1
    await todayCell.click();
    await expect(page.getByText(/3 sets across 1 workout/)).toBeVisible();

    // --- Weekly metric switcher ---
    // Workouts is the fourth option and the default. It was a whole separate bar chart above this
    // one until it folded in, so the guard that matters is that the tab now renders exactly ONE
    // weekly bar chart and that it opens on the series the old chart drew.
    const weeklyMetric = page.getByRole('group', { name: 'Weekly metric' });
    await expect(page.getByText('Workouts per week', { exact: true })).toBeVisible();
    await expect(weeklyMetric).toHaveCount(1);
    for (const option of ['Workouts', 'Volume', 'Sets', 'Reps']) {
      await expect(weeklyMetric.getByRole('button', { name: option, exact: true })).toBeVisible();
    }

    await weeklyMetric.getByRole('button', { name: 'Volume', exact: true }).click();
    await expect(page.getByText(/Volume lifted per week/)).toBeVisible();
    await expect(page.getByText('Workouts per week', { exact: true })).toBeHidden();

    await weeklyMetric.getByRole('button', { name: 'Sets', exact: true }).click();
    await expect(page.getByText('Sets per week', { exact: true })).toBeVisible();
    await expect(page.getByText(/Volume lifted per week/)).toBeHidden();

    await weeklyMetric.getByRole('button', { name: 'Reps', exact: true }).click();
    await expect(page.getByText('Reps per week', { exact: true })).toBeVisible();

    // Hovering this chart used to throw inside the tooltip and unmount the whole app -- the
    // symptom was the entire page going white, not a broken chart. The unit test in
    // WeeklyMetricChart.test.jsx covers the actual undefined-metric cause (which needs a
    // persisted UI slice a fresh registration can't have); this just proves the chart survives
    // being hovered at all, which nothing covered before.
    // See docs/incidents/2026-08-08-trends-hover-blank-page.md.
    await page.locator('.recharts-wrapper').first().hover();
    await expect(page.getByText('Reps per week', { exact: true })).toBeVisible();

    // --- All-time records (asserted before the exercise metric switches, see the header note) ---
    await expect(page.getByText('All-time bests')).toBeVisible();
    // The whole point of keeping an Epley-based row next to the raw one: 185x8 estimates to
    // ~234 lb and beats the 225x1 single, so these two rows genuinely disagree.
    await expect(recordRow(page, 'Best est. 1RM')).toContainText('234.3 lb');
    await expect(recordRow(page, 'Best est. 1RM')).toContainText('185 lb × 8');
    await expect(recordRow(page, 'Heaviest weight')).toContainText('225 lb × 1');
    // 185 x 8 = 1480 beats 135 x 10 = 1350 and 225 x 1 = 225.
    await expect(recordRow(page, 'Best set volume')).toContainText('1480 lb');
    await expect(recordRow(page, 'Total sets')).toContainText('3');
    await expect(recordRow(page, 'Total reps')).toContainText('19');

    // --- Per-exercise metric switcher ---
    await expect(page.getByText('Exercise progress · est. 1RM')).toBeVisible();
    const exerciseMetric = page.getByRole('group', { name: 'Exercise metric' });

    await exerciseMetric.getByRole('button', { name: 'Top weight', exact: true }).click();
    await expect(page.getByText('Exercise progress · heaviest weight')).toBeVisible();

    await exerciseMetric.getByRole('button', { name: 'Reps', exact: true }).click();
    await expect(page.getByText('Exercise progress · total reps')).toBeVisible();
  });

  // Every chart on this tab answers a question that LOOKS obvious and isn't -- most of all the
  // line chart, whose dots are one per SESSION (not per day) and whose meaning changes with the
  // metric switcher, two of whose five options are session totals rather than a best set.
  test('every chart has a "?" that explains its own datapoints in plain English', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await logSet(page, 225, 1);
    await logSet(page, 185, 8);

    await page.getByRole('link', { name: 'Trends' }).click();

    // All three are present and, crucially, closed -- their copy repeats phrases the rest of this
    // file selects by, so an always-mounted panel would break the specs above. It was four until
    // workouts-per-week stopped being a chart of its own and became a metric on the weekly
    // switcher, which took its "?" with it.
    const consistencyHelp = page.getByRole('button', { name: 'What the consistency grid shows' });
    const weeklyHelp = page.getByRole('button', { name: 'What the weekly totals chart shows' });
    const progressHelp = page.getByRole('button', { name: 'What the progress chart shows' });
    for (const trigger of [consistencyHelp, weeklyHelp, progressHelp]) {
      await expect(trigger).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'What the workouts chart shows' })).toHaveCount(0);
    await expect(page.getByText(/One dot per workout session/)).toBeHidden();

    // --- The heatmap says it ignores the range toggle, which nothing else on screen does ---
    await consistencyHelp.click();
    await expect(page.getByText(/always the last 6 months/)).toBeVisible();

    // --- The weekly bars follow their own metric switcher, and open on Workouts ---
    const weeklyMetric = page.getByRole('group', { name: 'Weekly metric' });

    // Workouts is the default, so this is the first panel a new household sees here. What it has
    // to say is the same thing the standalone chart's "?" said: a bar is SESSIONS, not exercises
    // and not sets.
    await weeklyHelp.click();
    await expect(page.getByText(/always the last 6 months/)).toBeHidden(); // the first one closed
    await expect(page.getByText(/counts separate workout sessions/)).toBeVisible();

    await weeklyMetric.getByRole('button', { name: 'Volume', exact: true }).click();
    await weeklyHelp.click();
    await expect(page.getByText(/Volume is weight × reps/)).toBeVisible();
    await expect(page.getByText(/counts separate workout sessions/)).toBeHidden();
    await weeklyMetric.getByRole('button', { name: 'Sets', exact: true }).click();
    await weeklyHelp.click();
    await expect(page.getByText(/Every set you logged that week counts once/)).toBeVisible();

    // --- The line chart: one dot per session, and what the dot measures follows the metric ---
    await progressHelp.click();
    await expect(page.getByText(/One dot per workout session/)).toBeVisible();
    await expect(page.getByText(/Two sessions in the same day give you two dots/)).toBeVisible();
    await expect(page.getByText(/best single set, scored by estimated 1RM/)).toBeVisible();
    // The PR rule the chart gives no other clue about: green is judged on one measure regardless
    // of the metric, so a PR dot need not be the high point of the line you are looking at. It
    // must NOT be described as an estimated 1RM -- that measure is a rep count for a bodyweight
    // exercise and seconds for a hold (StatsService#comparableValue).
    await expect(page.getByText(/not always the highest point on this chart/)).toBeVisible();
    await expect(page.getByText(/rep count for a bodyweight exercise/)).toBeVisible();

    // Escape closes it, the same exit Modal offers.
    await page.keyboard.press('Escape');
    await expect(page.getByText(/One dot per workout session/)).toBeHidden();

    // A session TOTAL has to say so -- reading "Volume" as a best set is the misunderstanding
    // this whole affordance exists to prevent.
    const exerciseMetric = page.getByRole('group', { name: 'Exercise metric' });
    await exerciseMetric.getByRole('button', { name: 'Volume', exact: true }).click();
    await progressHelp.click();
    await expect(page.getByText(/session total, not one set/)).toBeVisible();
    await expect(page.getByText(/best single set, scored by estimated 1RM/)).toBeHidden();

    // ...and a best-set metric has to say THAT, including that it is often a different set.
    await progressHelp.click();
    await exerciseMetric.getByRole('button', { name: 'Top weight', exact: true }).click();
    await progressHelp.click();
    await expect(page.getByText(/heaviest weight you touched that session/)).toBeVisible();
    await expect(page.getByText(/session total, not one set/)).toBeHidden();
  });

  // Only a real browser can prove this: jsdom computes no layout, so ChartHelp's clamping effect
  // is a no-op in every unit test and this is the sole place the geometry is checked.
  test('a help panel stays fully on screen on a phone, wherever its "?" ended up', async ({ page, request }) => {
    // 390px is an iPhone in portrait. It matters because WeeklyMetricChart's header WRAPS at this
    // width, moving its "?" from the card's right edge into the middle of a row -- and a panel
    // hung off the right of a mid-row trigger started 45px off the left of the screen, with the
    // first characters of every line clipped.
    await page.setViewportSize({ width: 390, height: 844 });
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await logSet(page, 185, 8);

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByTestId('consistency-grid')).toBeVisible();

    const labels = [
      'What the consistency grid shows',
      'What the weekly totals chart shows',
      'What the progress chart shows',
    ];

    for (const label of labels) {
      const trigger = page.getByRole('button', { name: label });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();

      const panel = page.getByRole('note');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box, `${label}: panel has no box`).not.toBeNull();
      expect(box!.x, `${label}: panel runs off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label}: panel runs off the right edge`).toBeLessThanOrEqual(390);

      await page.keyboard.press('Escape');
    }
  });

  // Only a real browser can prove this too: jsdom lays nothing out, so a flex item shrinking its
  // box below its own label's rendered width -- the actual mechanism of the bug -- is invisible
  // to every unit test. Regression for the exercise metric switcher's five pills (Est. 1RM / Top
  // weight / Volume / Best set / Reps) overflowing on top of each other on an iPhone-portrait
  // Trends card; see .seg-fill .seg-item in index.css.
  test('the exercise metric pills never overflow their own box on a phone', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await logSet(page, 185, 8);

    await page.getByRole('link', { name: 'Trends' }).click();
    const exerciseMetric = page.getByRole('group', { name: 'Exercise metric' });
    await expect(exerciseMetric).toBeVisible();

    for (const label of ['Est. 1RM', 'Top weight', 'Volume', 'Best set', 'Reps']) {
      const pill = exerciseMetric.getByRole('button', { name: label, exact: true });
      const overflow = await pill.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `"${label}" pill's label is wider than its own box by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  // The same measurement one control over, across every iPhone-portrait width rather than one.
  // The weekly switcher was a comfortable 3 pills until workouts-per-week stopped being its own
  // chart and became a fourth option, and SegmentedToggle's own header puts the limit at "more
  // than ~3" -- so this control crossed the line the exercise switcher's bug was found on.
  //
  // Two requirements, and the second is why this measures against the CARD and not the viewport.
  // A first cut of this test asserted the group stayed inside the 390px viewport, which it did --
  // while the "?" beside it sat outside the card's right border at 375px, visible in a screenshot
  // and invisible to the assertion. The viewport is not the container; the card is.
  for (const width of [320, 375, 390, 393, 402, 430]) {
    const claim = width >= ONE_LINE_MIN_WIDTH ? 'stay on one line inside their card' : 'stay inside their card';
    test(`the weekly metric pills ${claim} at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await registerHousehold(page, request, 'Nate');

      await pickExercise(page, 'Barbell Bench Press');
      await logSet(page, 185, 8);

      await page.getByRole('link', { name: 'Trends' }).click();
      const weeklyMetric = page.getByRole('group', { name: 'Weekly metric' });
      await expect(weeklyMetric).toBeVisible();

      // The one-line claim is asserted under 2px of extra letter-spacing, NOT at the runner's
      // natural font. That matters for two reasons.
      //
      // First, the natural font is not the same font twice. The app's stack is `-apple-system,
      // BlinkMacSystemFont, 'SF Pro Text'`, which falls through to a substitute on every non-Apple
      // platform -- a narrower one on a Windows dev machine than on the Linux CI runner. The first
      // version of this test had no style tag, passed locally at all six widths, and failed lower
      // at 320px on nothing but that difference. A layout budget asserted against an accidental
      // font is not asserted at all.
      //
      // Second, `letter-spacing` is the right lever where a named font is not: it adds a fixed
      // number of pixels per character whatever the face, so it is reproducible across platforms.
      // (Naming a "wide" font is not -- "Times New Roman" is actually NARROWER here than the
      // Windows default sans, so a style tag borrowed from sticky-chrome.spec.ts would have made
      // this test *weaker* while looking stricter.)
      //
      // 2px/char is ~44px across these four labels. Measured headroom: 375px survives 3px/char,
      // 320px wraps between 1.5 and 2. So 375-and-up carries a real margin, and 320px does not --
      // see the width guard below.
      if (width >= ONE_LINE_MIN_WIDTH) {
        await page.addStyleTag({ content: '.seg-item { letter-spacing: 2px !important; }' });
      }

      const tops: number[] = [];
      for (const label of ['Workouts', 'Volume', 'Sets', 'Reps']) {
        const pill = weeklyMetric.getByRole('button', { name: label, exact: true });
        const box = (await pill.boundingBox())!;
        expect(box, `"${label}" pill has no box`).not.toBeNull();
        tops.push(Math.round(box.y));

        // A pill whose label is wider than its own box paints on top of its neighbour rather than
        // wrapping -- the exercise switcher's original bug, one control over. True at every width.
        const overflow = await pill.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflow, `"${label}" pill's label is wider than its own box by ${overflow}px`).toBeLessThanOrEqual(1);
      }

      // ONE LINE, from 375px up. `.seg-fill` is allowed to wrap, and a two-and-two split of four
      // pills is a legitimate CSS outcome that just isn't the one this control wants -- so it is
      // asserted, not assumed.
      //
      // 320px is deliberately excluded from this half. It is the iPhone SE 1st gen / iPhone 5,
      // discontinued in 2018; every iPhone Apple currently ships is 375px or wider. At 320px the
      // four pills fit on one line at the natural font with roughly 20px to spare, which is inside
      // the margin between one platform's substitute font and another's -- so asserting it here
      // would be asserting the runner's font, which is exactly the failure this comment block is
      // about. What 320px still gets, below, is the guarantee that matters: nothing overflows the
      // card. Wrapping to two rows there is graceful and legible; overflowing is not.
      if (width >= ONE_LINE_MIN_WIDTH) {
        expect(new Set(tops).size, `the four pills split across ${new Set(tops).size} lines at ${width}px`).toBe(1);
      }

      // INSIDE THE CARD -- the control and the "?" both, measured against the card's own padding
      // box rather than the viewport.
      const card = await weeklyMetric.evaluate((el) => {
        const c = el.closest('div[style*="border-radius"]')!;
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
      });
      const group = (await weeklyMetric.boundingBox())!;
      expect(group.x, `the pills start left of the card at ${width}px`).toBeGreaterThanOrEqual(card.left - 1);
      expect(group.x + group.width, `the pills run past the card at ${width}px`).toBeLessThanOrEqual(card.right + 1);

      const help = (await page.getByRole('button', { name: 'What the weekly totals chart shows' }).boundingBox())!;
      expect(help.x + help.width, `the "?" sits outside the card at ${width}px`).toBeLessThanOrEqual(card.right + 1);

      // Nothing inside THIS card may reach past the viewport. Deliberately scoped to the weekly
      // card rather than the whole page: the 26-week consistency grid above is a fixed ~407px and
      // already overhangs a 320px screen on its own, so a page-wide assertion here would fail on
      // somebody else's pre-existing layout and read as though the switcher had caused it.
      const cardOverflow = await weeklyMetric.evaluate((el, vw) => {
        const card = el.closest('div[style*="border-radius"]')!;
        let worst: string | null = null;
        let worstRight = vw + 1;
        for (const node of Array.from(card.querySelectorAll('*'))) {
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.right > worstRight) {
            worstRight = r.right;
            worst = `${node.tagName.toLowerCase()} at ${Math.round(r.right)}px`;
          }
        }
        return worst;
      }, width);
      expect(cardOverflow, `the weekly chart card reaches past the ${width}px viewport`).toBeNull();
    });
  }

  test('a bodyweight-only lift gets a rep-based records view, not a column of zeros', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Chin-up');
    await logSet(page, 0, 12);

    await page.getByRole('link', { name: 'Trends' }).click();

    await expect(page.getByText('Records · bodyweight')).toBeVisible();
    await expect(recordRow(page, 'Most reps in a set')).toContainText('12 reps');
    await expect(recordRow(page, 'Total reps')).toContainText('12 reps');

    // The weight-based rows are suppressed entirely -- see StatsService#comparableLb for why
    // every weight record is meaningless at weight 0. That includes the est. 1RM, which Epley
    // collapses to 0 whatever the rep count.
    await expect(page.getByText('All-time bests')).toBeHidden();
    await expect(page.getByText('Best est. 1RM', { exact: true })).toBeHidden();
    await expect(page.getByText('Heaviest weight', { exact: true })).toBeHidden();
  });

  test('a bodyweight-only lift hides the weight-based chart metrics too, not just the records table', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Chin-up');
    await logSet(page, 0, 12);

    await page.getByRole('link', { name: 'Trends' }).click();

    // Top weight/Volume/Best set are raw weight or weight x reps, always 0 for a bodyweight lift
    // -- hidden from the switcher rather than shown as flat zero lines, the chart-switcher
    // equivalent of the records table's rep-focused view above. Est. 1RM survives (it already
    // substitutes rep count at weight 0) and so does Reps.
    const exerciseMetric = page.getByRole('group', { name: 'Exercise metric' });
    await expect(exerciseMetric.getByRole('button', { name: 'Est. 1RM', exact: true })).toBeVisible();
    await expect(exerciseMetric.getByRole('button', { name: 'Reps', exact: true })).toBeVisible();
    await expect(exerciseMetric.getByRole('button', { name: 'Top weight', exact: true })).toBeHidden();
    await expect(exerciseMetric.getByRole('button', { name: 'Volume', exact: true })).toBeHidden();
    await expect(exerciseMetric.getByRole('button', { name: 'Best set', exact: true })).toBeHidden();
  });

  test('a lapsed person is told the range is empty, not that they have never trained', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // A brand-new person with nothing logged gets the onboarding copy.
    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText(/No workouts logged yet/)).toBeVisible();

    await page.getByRole('link', { name: 'Log' }).click();
    await pickExercise(page, 'Barbell Back Squat');
    await logSet(page, 135, 5);

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText(/No workouts logged yet/)).toBeHidden();
    await expect(page.getByTestId('consistency-grid')).toBeVisible();
  });

  test('each person keeps their own Trends metric selections', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await logSet(page, 135, 5);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Sam is auto-selected on add. Back to Nate to pick a non-default weekly metric.
    await personPill(page, 'Nate').click();
    await page.getByRole('link', { name: 'Trends' }).click();
    await page.getByRole('group', { name: 'Weekly metric' }).getByRole('button', { name: 'Sets', exact: true }).click();
    await expect(page.getByText('Sets per week', { exact: true })).toBeVisible();

    // Sam resumes their own last tab (Log), so navigate to Trends explicitly. Sam has no data,
    // and crucially must NOT inherit Nate's 'Sets' choice as if it were a shared global.
    await personPill(page, 'Sam').click();
    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText(/No workouts logged yet/)).toBeVisible();

    // Back to Nate: still on Sets.
    await personPill(page, 'Nate').click();
    await expect(page.getByText('Sets per week', { exact: true })).toBeVisible();
  });
});
