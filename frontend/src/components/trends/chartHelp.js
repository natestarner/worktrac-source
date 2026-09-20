// Plain-English explanations of what a mark on each Trends chart actually represents, shown by
// the "?" (components/shared/ChartHelp.jsx) on every chart header.
//
// These exist because the charts answer questions that LOOK obvious and aren't:
//   - the line chart plots one dot per SESSION, not per day, so two workouts in a day give two
//     dots stacked on the same date label;
//   - what that dot measures changes with the metric switcher, and two of the five metrics are
//     session totals rather than a best set;
//   - PR dots track estimated 1RM whatever metric is on screen (a PR is a fact about the session,
//     not about the current view -- see ExerciseTrendChart.jsx);
//   - the heatmap deliberately ignores the range toggle.
//
// The per-metric sentence lives on the metric spec itself (`dotMeaning` / `barMeaning`) and is
// read through metricSpec/weeklyMetricSpec, never off the table directly -- see the note in
// .claude/rules/trends.md about the tooltip that blanked the page on an unrecognized metric.
//
// Each `label` is the "?" button's accessible name. They must stay mutually non-containing:
// Playwright matches an accessible name as a case-insensitive SUBSTRING, and the three Trends ones
// are on screen at once. prRecordHelp's label lives here with them even though it renders on the
// PRs tab, because checking four labels against each other is only easy where they sit side by
// side -- and that check is what chartHelp.test.js does.
// Both specs come from the metric-table modules, never from the chart components -- the charts
// import this file, so reaching back into one would close an import cycle.
import { metricSpec } from './exerciseMetrics';
import { weeklyMetricSpec } from './weeklyMetrics';

export const CONSISTENCY_HELP = {
  label: 'What the consistency grid shows',
  title: 'Consistency',
  lines: [
    'One square per day, oldest on the left. The darker the square, the more sets you logged that day.',
    'This grid is always the last 6 months. The range buttons at the top of the tab do not change it.',
    'Tap a square for that day’s totals.',
  ],
};

export function weeklyMetricHelp(metric) {
  const spec = weeklyMetricSpec(metric);
  return {
    label: 'What the weekly totals chart shows',
    title: `${spec.label} per week`,
    // Only the week bucketing is shared by all four metrics now. "…adding up every exercise you
    // did that week" used to live on this line, and it is false of Workouts -- that bar counts
    // sessions and is indifferent to how many exercises are inside them. The scope of each bar
    // moved onto the barMeanings, where it can differ per metric.
    lines: ['One bar per week, starting Monday.', spec.barMeaning],
  };
}

export function exerciseTrendHelp(metric) {
  const spec = metricSpec(metric);
  return {
    label: 'What the progress chart shows',
    // Named for the metric currently selected (e.g. "Top weight"), not a generic "Exercise
    // progress" -- the lines below are specific to whichever of the five metrics is on screen,
    // and a fixed title read as if they applied to all of them. Mirrors weeklyMetricHelp's use of
    // spec.label as the identifying half of its own title.
    title: spec.label,
    lines: [
      'One dot per workout session that included this exercise, not one per day. Two sessions in the same day give you two dots.',
      spec.dotMeaning,
      // Deliberately NOT "a new best estimated 1RM". PR marking runs through
      // StatsService#comparableValue, which ranks a bodyweight set by its rep count and a hold by
      // its seconds -- calling either an estimated 1RM is the "rep count wearing a costume"
      // mistake .claude/rules/trends.md exists to prevent, and it would be wrong on every metric,
      // not just this one. What the reader actually needs from this line is why a green dot is
      // sometimes not the highest point on the chart in front of them.
      'A larger green dot is a personal record: a new best for this exercise as of that session. ' +
        'PRs are judged the same way whatever this chart is showing: estimated 1RM for a loaded ' +
        'lift, rep count for a bodyweight exercise, time for a hold. So a green dot is not always ' +
        'the highest point on this chart.',
      'Dots are spaced evenly, so the gap between two of them does not show how much time passed.',
    ],
  };
}

// The PRs board's record picker. Same shape and same source specs as exerciseTrendHelp above,
// because the picker and the chart's metric switcher offer the same five words -- the whole reason
// recordMeaning lives on EXERCISE_METRICS rather than in a table of its own.
//
// The dash line is the one thing here the chart has no equivalent of: the chart hides a metric it
// cannot plot for the selected exercise, while the board is a mix of exercises and shows a dash per
// row instead. Somebody looking at a column with three dashes in it needs to be told that is an
// answer, not a gap.
export function prRecordHelp(measure) {
  const spec = metricSpec(measure);
  return {
    // Deliberately contains neither "Record" nor "Sort" -- the two dropdowns beside it are
    // labelled exactly that, and Playwright matches an accessible name as a case-insensitive
    // SUBSTRING. "What these records show" made getByLabel('Record') ambiguous with this button
    // and every selectOption on the picker a strict-mode violation. Same rule as the four Trends
    // help labels, one screen over.
    label: 'What this board is measuring',
    title: spec.label,
    lines: [
      'Every row is your all-time best for that exercise on the record picked above. Changing the record changes the number on every row, and the date beside it.',
      spec.recordMeaning,
      'A dash means the record does not apply to that exercise: a pull-up has no top weight, and a timed hold has no reps.',
    ],
  };
}
