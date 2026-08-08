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
  a rep-max column of `0 lb` is worse than no column. `RecentPrsCard` does the same per row.

## Ranges: what follows the toggle and what deliberately doesn't

| Data | Window | Why |
|---|---|---|
| `weeks[]`, exercise trend points | the `weeks` param | what the toggle is for |
| `workoutDays` (heatmap) | fixed trailing `HEATMAP_DAYS` (182) | 4 columns reads as broken, 260 is unusable on a phone |
| `recentPrs` | fixed trailing `RECENT_PR_DAYS` (30) | "what got better lately" isn't relative to a viewing window |
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
past workout" sorts as today. `buildRecentPrs` and `getExerciseTrend` both re-sort by the
session's `startedAt` first. This deliberately can disagree with the PR celebration that fired at
log time (`WorkoutSetService` compares against the best known at insert time) — don't "fix" that
into agreement.

## No new full-history loads

`StatsService` already loads every set a person has ever logged on four separate paths, with zero
SQL-side aggregation. Weekly sets/reps, `workoutDays`, `recentPrs` and `hasAnyHistory` are all
computed inside `getOverview`'s existing single pass; the per-session metrics inside
`getExerciseTrend`'s. **A new metric folds into one of those passes or gets a projection/`@Query`
aggregate — it does not add a fifth `findByPerson_Id...` call.**

## Charts

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
