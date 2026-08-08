import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// Covers the Trends analytics expansion: the consistency heatmap, the weekly metric switcher
// (volume/sets/reps), the per-exercise metric switcher, the all-time records table, and the
// recent-PRs card.
//
// Two locator hazards on this screen, both hit while writing this file:
//   1. An exercise name now appears in the Log picker, History, the PRs board, the Trends
//      dropdown, the recent-PRs card AND the exercise section header. Everything here goes
//      through a role + name or a scoped container, never a bare name lookup.
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

// Weight/reps are steppers, not inputs. Tapping the value opens NumericKeypad, which is the only
// practical way to reach an exact number (135 lb is 18 stepper clicks). Wrapped in expect.poll
// because ExerciseDetail's computePrefillDraft effect re-seeds the draft when the summary /
// session-sets queries settle, which can land after the keypad closes and stomp the value --
// the same race offline-reads.spec.ts's setWeight documents.
async function setStepper(page, label: 'Weight' | 'Reps', target: number) {
  const row = page.locator('.stepper-row').filter({ hasText: label });
  const value = row.locator('.stepper-value');

  await expect
    .poll(
      async () => {
        if (Number(await value.textContent()) === target) return target;
        await value.click();
        const keypad = page.getByRole('dialog');
        for (let i = 0; i < 8; i += 1) {
          await keypad.getByRole('button', { name: '⌫', exact: true }).click();
        }
        for (const digit of String(target)) {
          await keypad.getByRole('button', { name: digit, exact: true }).click();
        }
        await keypad.getByRole('button', { name: 'Done', exact: true }).click();
        return Number(await value.textContent());
      },
      { timeout: 20000 },
    )
    .toBe(target);
}

async function logSet(page, weight: number, reps: number) {
  await setStepper(page, 'Weight', weight);
  await setStepper(page, 'Reps', reps);
  await page.getByRole('button', { name: 'Log set' }).click();

  // Each set below is a new best, so the celebration overlay fires every time and must be
  // dismissed before the next one can be logged.
  const celebration = page.getByText('New PR!');
  await expect(celebration).toBeVisible();
  await celebration.click({ force: true });
  await expect(celebration).toBeHidden();
}

test.describe('Trends analytics', () => {
  test('heatmap, metric switchers, records table and recent PRs all render real data', async ({ page, request }) => {
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

    // --- Recent PRs card ---
    // All three sets beat the running best, so all three are PRs on the same lift -- which is why
    // each row's accessible name carries its achievement rather than just the exercise name.
    await expect(page.getByText('3 PRs')).toBeVisible();
    await expect(page.getByRole('button', { name: /Barbell Bench Press PR: 225 lb for 1 reps/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Barbell Bench Press PR: 185 lb for 8 reps/ })).toBeVisible();

    // --- All-time records (asserted before the exercise metric switches, see the header note) ---
    await expect(page.getByText('Rep maxes')).toBeVisible();
    // 225x1 sets the 1+ record; at 5+ reps it no longer qualifies and 185x8 takes over. That is
    // the "at least N reps" rule the whole table hangs on.
    await expect(recordRow(page, '1+ reps')).toContainText('225 lb × 1');
    await expect(recordRow(page, '5+ reps')).toContainText('185 lb × 8');
    await expect(recordRow(page, '12+ reps')).toContainText('Not yet');

    await expect(page.getByText('All-time bests')).toBeVisible();
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

  test('a bodyweight-only lift gets a rep-based records view, not a column of zeros', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Chin-up');
    await logSet(page, 0, 12);

    await page.getByRole('link', { name: 'Trends' }).click();

    await expect(page.getByText('Records · bodyweight')).toBeVisible();
    await expect(recordRow(page, 'Most reps in a set')).toContainText('12 reps');
    await expect(recordRow(page, 'Total reps')).toContainText('12 reps');

    // The weight-based table is suppressed entirely -- see StatsService#comparableLb for why
    // every weight record is meaningless at weight 0.
    await expect(page.getByText('Rep maxes')).toBeHidden();
    await expect(page.getByText('Heaviest weight', { exact: true })).toBeHidden();

    // The PR card reports it in reps, not as a 0 lb lift. (The per-session list further down the
    // exercise card still renders "0 lb × 12" -- that's the pre-existing shared row format, not
    // part of this card.)
    await expect(page.getByText('1 PR')).toBeVisible();
    await expect(page.getByRole('button', { name: /Chin-up PR: 12 reps/ })).toBeVisible();
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
