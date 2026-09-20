---
paths:
  - "frontend/src/components/trends/**"
  - "frontend/src/components/prs/**"
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
  tie at 0. The exercise chart's metric switcher applies the same rule one level up:
  `exerciseMetrics.js#visibleMetricOptions` drops "Top weight"/"Volume"/"Best set" (raw weight or
  weight × reps, so a flat zero line regardless of rep count) whenever `records.bodyweightOnly` is
  true, reusing that same already-fetched field rather than adding a new one. "Est. 1RM" and
  "Reps" stay, since the first already substitutes rep count at weight 0. `ExerciseTrendSection`
  falls back the *displayed* metric to `est1rm` when the person's stored preference isn't in the
  filtered list for the currently-selected exercise — it never overwrites that stored preference,
  so switching back to a weighted exercise restores it.

### The PRs board makes the same call PER ROW, not per board

`EXERCISE_METRICS` is now the vocabulary for **two** screens: the chart's metric switcher and the
PRs board's record picker (`components/prs/prMeasures.js`). They read the same specs so "Volume"
cannot mean a session total on one and a single set on the other, and a new measure ships with
`recordMeaning` + `sortLabel` alongside `dotMeaning` — on the spec, never in a parallel table.

Where they legitimately differ is **filtering**, and it is the one divergence to preserve:

- The chart shows ONE exercise, so `visibleMetricOptions` can hide the weight-derived metrics
  outright for a bodyweight lift.
- The board is a MIX of exercises and its picker is board-wide, so applicability is decided per
  row instead: `measureEntry` returns **null**, and the row renders an em dash with a caption
  naming why. **Do not filter the board's picker** — that would hide "Top weight" from every row
  because one pull-up cannot use it.
- A null entry **sorts last**, grouped and name-ordered, and is never coerced to 0. Treating it as
  a number interleaves unrankable rows through the ranking, putting a pull-up above a genuinely
  light lift — the generalization of the bodyweight grouping `sortPrRows` has always done.
- `PrRowDto.bodyweightOnly` / `durationTracked` are what the caption reads. They mirror
  `ExerciseRecordsDto`'s fields of the same name deliberately; don't add a third spelling.

`PrRowDto.best` **is** the est.-1RM measure and is deliberately not repeated inside `measures` —
it is the set `comparableValue` picks, substitutions and all. Two copies of one number drift.

## A hold is the same call as bodyweight, one measure over

`ExerciseRecordsDto.durationTracked` flips the records table to a time-focused view for exactly the
reason `bodyweightOnly` flips it to a rep-focused one: a hold carries `reps = 0`, so every weight-
and rep-derived record is `0`, and a column of zeros is worse than no column. `bestEst1rm` and
`mostReps` are **null** whenever `durationTracked` is true; `longestHold` and `heaviestLoadHeld`
carry the signal, and stay two records rather than one fused load-adjusted score.

`WeeklyPointDto.totalHoldSeconds` exists because a hold contributes 0 to both volume and reps —
without it a week of plank and wall-sit work reads as no work at all on every chart but set count.
Both fold into the **existing** `getOverview` / `getExerciseTrend` / `getExerciseRecords` passes;
neither adds a query.

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
| `hasAnyHistory` | all time — **pre-clamp** | separates a new person from a lapsed one — see below |
| `/exercises/{id}/records` | all time, **no `weeks` param** | a record isn't relative to the range; keeping it out of the URL *and* the query key is what stops the toggle refetching it |

**Don't add `weeks` to the records endpoint or `queryKeys.exerciseRecords`.**

### `hasAnyHistory` is read BEFORE the Free-tier window narrows the set list

`getOverview` computes it from the unclamped repository result, not from the `visibleTo(...)` output
every other aggregate on that DTO uses. It was derived post-clamp for a long time, which made it
answer the wrong question for exactly the households it exists to serve: a Free household whose
whole training history predates the 90-day window got *"No workouts logged yet. Trends will show up
here once a few sessions are in the books."* — told they had never trained, by the field added to
stop that. The window clamps **display**; it must never change what the app believes about a person.
Guarded by `FreeTierHistoryWindowTest#aFreeHouseholdWithOnlyOldHistoryIsNotToldItHasNeverTrained`.

### The empty state has THREE cases, not two

The third is "nothing in this range, and there is more behind the Free window". *"Try a wider
range"* is a loop for that household — widening the range is precisely what the window is clipping,
so it cannot reach what it is hiding. `TrendsTab` renders `HistoryWindowNotice` instead; see
`billing.md`. The notice shows on **every** range, not just the wide ones, because the consistency
grid ignores the range toggle and is therefore clipped on all of them — but the range-specific lead
("this range shows…") appears only when the selected range really does reach past the window,
since at 4wk and 12wk the charts for that range are complete and the lead would be false.

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
  heatmap's rows and the bar chart must agree or the same day lands in different weeks.

### There is ONE weekly bar chart, and a new weekly series is an option on it

`WeeklyMetricChart` plots any column of an `overview.weeks` row: `workoutCount`, `totalVolumeLb`,
`totalSets`, `totalReps`. Workouts-per-week was a second, visually identical chart
(`WeeklyFrequencyChart`) sitting directly above it until 2026-09-20, purely because it predated
the switcher — same card, same height, same accent, same Monday buckets, a sibling field off the
same row. **Don't add a second weekly bar chart back.** A new weekly series is an entry in
`WEEKLY_METRICS` with its own `barMeaning`; it must not add a fourth `?` label, because every
metric shares `'What the weekly totals chart shows'`.

- **A count metric must not be `isWeight`.** `convertWeight` would scale a 4-workout week to 1.8
  for a kg household.
- **The tooltip's noun goes through `countNoun`**, which singularizes at 1 — a one-session week is
  the most common bar this chart draws, and the standalone chart it replaced said "1 workout".
- **`weeklyMetricSpec`'s fallback tracks `PERSON_DEFAULTS.trendsWeeklyMetric`** (both `workouts`).
  Two different silent defaults for "unreadable persisted value" and "first visit" is a bug.
- **Changing the default is only safe because `HYDRATE` underlays `PERSON_DEFAULTS`** — a persisted
  `volume`/`sets`/`reps` must survive untouched, or the change reads as the app forgetting a
  setting. Pinned in `AppStateContext.test.js`.
- `weeklyMetricHelp`'s shared first line says **only** what is true of every metric (the Monday
  bucket). Scope — "adding up every exercise you did that week" — lives on each `barMeaning`,
  because it is false of Workouts.
- **A fifth option needs `.seg-fill`'s budget checked, not just a label.** The control is `fill`
  on its own row precisely because the fourth pill stopped fitting: at intrinsic padding the
  toggle plus the `?` came to ~334px against a 303px row on a 375px phone, which put the `?`
  outside the card's right border. `.seg` cannot wrap, so it overflows rather than reflowing.
  `trends.spec.ts` measures six widths from 320px up. Note `.seg-fill` *may* wrap (that is what
  saves the 5-pill exercise switcher), so "all four on one line" is asserted, never assumed.
- **Two different claims at two different widths, and the split is deliberate.**
  *Inside the card* is asserted at **every** width — that is the one that must never break.
  *One line* is asserted from **375px** up (`ONE_LINE_MIN_WIDTH`), the narrowest iPhone portrait
  Apple still ships. At 320px (the 2016 SE) the four fit at the natural font with only ~20px to
  spare, which is thinner than the gap between one platform's substitute font and another's.
- **Never assert this layout at the runner's natural font, and never by naming a "wide" font.**
  The app's stack falls through to a substitute on every non-Apple platform, and the Linux CI
  runner's is wider than a Windows dev machine's — the first version of this test had no style tag,
  passed locally at all six widths, and failed lower at 320px on nothing else. Use
  **`letter-spacing`**, which adds a fixed number of pixels per character whatever the face.
  Naming a font does *not* work: `"Times New Roman"` is **narrower** here than the Windows default
  sans, so borrowing that trick from `sticky-chrome.spec.ts` makes the test weaker while looking
  stricter. Measured headroom: 375px survives 3px/char, 320px wraps between 1.5 and 2.

## Every chart carries a "?" — keep it honest and keep it on screen

`components/shared/ChartHelp.jsx` + `trends/chartHelp.js`. A dot on the line chart is **one
session, not one day**, and three of the five exercise metrics are a single best set while two are
session totals — the chart shows no difference between them, which is what this exists to fix.

- **A new metric ships with its own sentence, on the spec.** `dotMeaning` lives on
  `EXERCISE_METRICS`, `barMeaning` on `WEEKLY_METRICS`, reached via `metricSpec`/`weeklyMetricSpec`
  like every other field. Don't start a parallel copy table keyed by metric name — that's the raw
  table lookup the hover-blank-page incident was about, one indirection later.
- **Say which one it is.** A best-set metric names the set; a total says "session total, not one
  set". `chartHelp.test.js` asserts both.
- **Never call the PR measure "estimated 1RM" flat out.** `isPr` follows `comparableValue`, which
  is a **rep count** at weight 0 and **seconds** for a hold — so that phrasing is wrong for
  pull-ups and planks on *every* metric, not just the rep ones. Name all three cases, or name
  none. The panel's PR line must also survive the metric switcher unchanged, because the measure
  does: what it owes the reader is why a green dot is not always the plotted line's high point.
- **The `?` labels must stay mutually non-containing** — the three Trends ones are on screen at
  once (the PRs one is checked with them), and Playwright matches an accessible name as a
  substring. Also asserted, as an exact count.
- **Don't delete `ChartHelp`'s measure-and-nudge effect, and don't replace it with a CSS clamp.**
  It exists because `WeeklyMetricChart`'s header used to wrap on a phone, moving its `?` mid-row
  so a right-anchored panel landed 45px off the left edge with the text clipped. Where the trigger
  ends up depends on the wrap point, so no static rule gets it right. jsdom has no layout — the
  bounding-box test in `trends.spec.ts` is the only guard.

  **That header no longer wraps** (2026-09-20): the switcher moved to its own full-width row when
  workouts became its fourth option, so every Trends `?` now sits at its card's right edge. The
  effect stays anyway — it is the general guard, the next wrapping header re-arms it silently, and
  the cost of keeping it is one measurement per open.
- **Keep the panel unmounted while closed.** Its copy repeats phrases other specs on this screen
  select by; an always-mounted panel breaks them.
