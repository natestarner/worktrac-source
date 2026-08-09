---
paths:
  - "frontend/src/components/trends/**"
  - "backend/src/main/java/com/worktrac/backend/stats/**"
---

# Trends & stats invariants

Full narrative: `docs/architecture/trends.md`.

## Weight 0 is a bodyweight lift, and it breaks every weight-based metric

`StatsService#comparableLb` returns the **rep count** instead of an Epley estimate when
`weight == 0`, because Epley collapses to 0 and every bodyweight set would tie forever.
`frontend/src/utils/formulas.js` mirrors this. Two consequences any new metric must respect:

- **An "est. 1RM" for a bodyweight lift is a rep count wearing a costume.** Don't label it as a
  weight, and don't make it the only available view — that's why `EXERCISE_METRICS` exists.
- **Whole weight-based readouts must disappear, not render zeros.** `ExerciseRecordsDto`'s
  `bodyweightOnly` (every set at weight 0) switches the records table to a rep-focused view;
  a column of `0 lb` is worse than no column. `bestEst1rm` is `null` for the same reason, and
  `sortPrRows` groups bodyweight rows last under the est.-1RM sort rather than letting them all
  tie at 0.

## `bestEst1rm` and `heaviestWeight` are different records — keep both

Epley rewards reps, so `185 x 8` (~234 lb) outranks a `225 x 1` single. `heaviestWeight` ranks on
**raw weight**; `bestEst1rm` ranks on the **Epley estimate**, skipping weight-0 sets entirely
rather than routing them through `comparableLb` (a rep count would beat pounds on any lightly
loaded lift). The est.-1RM row must always name the set behind it — a number larger than anything
you actually lifted reads as a bug otherwise.

This replaced the old `repMaxes` table (targets 1/3/5/8/10/12). Note the trap that removal exposed:
the `1+ reps` row was **not** a 1RM at all — `buildRepMaxes(1)` used the same
`isBetter(weight, reps, …)` comparator and identical candidate pool as `heaviestWeight`, so it was
an exact duplicate of it. Don't reintroduce a "1RM" row that ranks on raw weight.

## Ranges: what follows the toggle and what deliberately doesn't

| Data | Window | Why |
|---|---|---|
| `weeks[]`, exercise trend points | the `weeks` param | what the toggle is for |
| `workoutDays` (heatmap) | fixed trailing `HEATMAP_DAYS` (182) | 4 columns reads as broken, 260 is unusable on a phone |
| `hasAnyHistory` | all time | separates a new person from a lapsed one — see below |
| `/exercises/{id}/records` | all time, **no `weeks` param** | a record isn't relative to the range; keeping it out of the URL *and* the query key is what stops the toggle refetching it |

**Don't add `weeks` to the records endpoint or `queryKeys.exerciseRecords`.**

## Empty state: the range being empty ≠ never having trained

`overview.weeks` only describes the selected range. Keying the onboarding copy off it told a
lapsed user with years of history "No workouts logged yet" the moment they clicked 4wk. Branch on
the range-independent `hasAnyHistory`, and name the actual range via `rangeEmptyLabel` (the "All"
option is 5 years, not 12 weeks).

## PR chronology follows session `startedAt`, never set `created_at`

`findByPerson_IdOrderByCreatedAtAsc` orders by *insert* time, so a workout entered through "Log a
past workout" sorts as today. `getExerciseTrend` re-sorts by the session's `startedAt` first, and
the PRs board's "Most recent" sort ranks on `best.sessionStartedAt` for the same reason. This
deliberately can disagree with the PR celebration that fired at log time (`WorkoutSetService`
compares against the best known at insert time) — don't "fix" that into agreement.

## Trends does not re-render what another tab already owns

Trends' job is **aggregation over time**. A "Recent PRs" card lived here until 2026-08-08 and was
removed as redundant: every row repeated a PRs-board row — same exercise, same weight × reps, same
date — because a PR set in the last 30 days *is* that lift's all-time best. The board absorbed the
question instead, via its "Most recent" sort. Before adding anything PR- or session-shaped here,
check it isn't already a row on PRs or History.

## No new full-history loads

`StatsService` already loads every set a person has ever logged on four separate paths, with zero
SQL-side aggregation. Weekly sets/reps, `workoutDays` and `hasAnyHistory` are all computed inside
`getOverview`'s existing single pass; the per-session metrics inside `getExerciseTrend`'s;
`bestEst1rm` and the other all-time bests inside `getExerciseRecords`'s. **A new metric folds into
one of those passes or gets a projection/`@Query` aggregate — it does not add a fifth
`findByPerson_Id...` call.**

## Charts

- **Never index a metric table directly — always go through its fallback helper**
  (`metricSpec`, `weeklyMetricSpec`). This includes tooltips and any other lazily-mounted
  subcomponent: `WeeklyMetricChart`'s tooltip read `WEEKLY_METRICS[metric]` raw while the chart
  body fell back, so an unrecognized metric rendered fine and then blanked the entire page on
  hover. See `docs/incidents/2026-08-08-trends-hover-blank-page.md`.
- **Recharts is mocked out in jsdom** (`ResponsiveContainer` has no layout), so chart components
  are stubbed in `TrendsTab.test.jsx`. `ConsistencyHeatmap` is deliberately **plain DOM** for
  exactly this reason and has real tests — keep it that way, and keep its grid maths in
  `consistencyGrid.js` where it can be unit tested.
- Colours come from CSS custom properties passed straight to recharts, so dark mode is free.
  The heatmap's `--chart-heat-*` ramp is **sequential** (one hue, light→dark), validated with the
  dataviz skill's `validateOrdinal` against each mode's surface — not the categorical
  `--chart-cat-*` slots. Re-validate if you restep it; the categorical validator fails a correct
  sequential ramp by design.
- Weekly buckets start **Monday** (`DayOfWeek.MONDAY` server-side, `mondayOf` client-side). The
  heatmap's rows and the bar charts must agree or the same day lands in different weeks.
