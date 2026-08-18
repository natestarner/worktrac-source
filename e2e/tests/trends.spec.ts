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
    const weeklyMetric = page.getByRole('group', { name: 'Weekly metric' });
    await expect(page.getByText(/Volume lifted per week/)).toBeVisible();

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

    // All four are present and, crucially, closed -- their copy repeats phrases the rest of this
    // file selects by, so an always-mounted panel would break the specs above.
    const consistencyHelp = page.getByRole('button', { name: 'What the consistency grid shows' });
    const workoutsHelp = page.getByRole('button', { name: 'What the workouts chart shows' });
    const weeklyHelp = page.getByRole('button', { name: 'What the weekly totals chart shows' });
    const progressHelp = page.getByRole('button', { name: 'What the progress chart shows' });
    for (const trigger of [consistencyHelp, workoutsHelp, weeklyHelp, progressHelp]) {
      await expect(trigger).toBeVisible();
    }
    await expect(page.getByText(/One dot per workout session/)).toBeHidden();

    // --- The heatmap says it ignores the range toggle, which nothing else on screen does ---
    await consistencyHelp.click();
    await expect(page.getByText(/always the last 6 months/)).toBeVisible();

    // --- Workouts per week counts SESSIONS, not exercises or sets ---
    await workoutsHelp.click();
    await expect(page.getByText(/always the last 6 months/)).toBeHidden(); // the first one closed
    await expect(page.getByText(/counts separate workout sessions/)).toBeVisible();

    // --- The weekly bars follow their own metric switcher ---
    await weeklyHelp.click();
    await expect(page.getByText(/Volume is weight × reps/)).toBeVisible();
    await page.getByRole('group', { name: 'Weekly metric' }).getByRole('button', { name: 'Sets', exact: true }).click();
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
      'What the workouts chart shows',
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
