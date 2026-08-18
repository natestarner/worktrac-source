# Trends & analytics

Invariants: `.claude/rules/trends.md`. This file is the *why*.

## What the tab is for

History answers "what did I do on date X". The PRs board answers "what's my all-time best per
exercise". Trends' distinct job is **aggregation over time** — and, since 2026-08-07, one more
thing the other two can't do: give you a number you'd actually consult mid-workout.

That framing decides what belongs here. A per-exercise session list at the bottom of the exercise
card overlaps History slightly, on purpose — it's the context for the curve above it.

## The 2026-08-07 expansion

Trends launched with 3 stat tiles, a workouts-per-week bar chart, a volume-per-week bar chart, and
a single est.-1RM line chart. Benchmarked against Hevy, Strong and Boostcamp, two gaps stood out:

1. **Est. 1RM was the only per-exercise view.** For a lift with added load that's a reasonable
   default. For pull-ups it is actively wrong — see the weight-0 rule — and for high-rep accessory
   work it's noisy. One metric can't serve one exercise, let alone all of them.
2. **Nothing was actionable.** Every number described the past. None of them answered "what weight
   should I put on the bar right now", which is the question you have while holding the bar.

What shipped:

| Addition | The question it answers |
|---|---|
| Per-exercise metric switcher | "is this lift improving?" — by whichever measure suits it |
| Rep-max records table | "what have I done for 5+ before?" |
| Weekly Volume / Sets / Reps switcher | "how much did I actually train?" |
| Consistency heatmap | "am I showing up?" |
| Recent PRs | "what got better lately?" |

Two of those five were walked back on 2026-08-08 — see below.

### Why a switcher instead of more charts

The obvious implementation is one chart per metric. Trends is used on a phone between sets, and
five stacked 200px charts push everything below them off the screen. A switcher is one chart's
worth of vertical space for five charts' worth of information, and it costs no extra request
because all five series ride on the one `/trends/exercises/{id}` response.

The cost is discoverability — a metric you don't switch to is a metric you don't know exists. The
segmented pills are borrowed from the range toggle that was already on this screen, so the control
reads as familiar rather than novel. (`SegmentedToggle` was extracted from `RangeToggle` for this;
three lookalike controls that could drift apart was the alternative.)

### Why "at least N reps" for rep maxes

*(Removed 2026-08-08 — kept here because the reasoning explains what replaced it.)*

The two readings of "5RM" are *best weight at exactly 5 reps* and *best weight at 5 or more*. Exact
matching leaves most rows blank for anyone who doesn't happen to train at those precise rep counts,
and it discards real information: a 6-rep set at 185 genuinely proves you can do 5 at 185. Rows
therefore report the set that actually set the record, so "5+ reps" can legitimately read
"185 lb × 8" — which looks like a bug until you know the rule, hence the label.

## The 2026-08-08 trim

Two of the 2026-08-07 additions turned out to be duplicating other surfaces rather than adding to
them.

### Recent PRs was the PRs board, rendered twice

The card's rows and the PRs board's rows carried the same exercise name, the same weight × reps and
the same date — necessarily, because a PR set in the last 30 days *is* that lift's all-time best.
The card's genuinely distinct information (the *delta* versus the previous best, and the
working-up case where one lift PRs several times in a session) was the one thing it never
rendered.

Two ways out: teach the card to show deltas, or move the question to the board. The board won —
"what got better lately" is an *ordering* of the PRs you already have, not a second list of them.
It's now the `recent` option in `utils/prSort.js`, and the default, so the tab opens on exactly
what the card was for. `buildRecentPrs`, `RecentPrDto` and `TrendsOverviewDto.recentPrs` are gone
with it.

The general rule this leaves: Trends aggregates over time. If a proposed addition is PR- or
session-shaped, it probably belongs on PRs or History.

### The "1RM" rep max was not a 1RM

The intent was to drop the 3/5/8/10/12 rep-max rows and keep the 1RM. Reading the code first
showed the 1-rep row wasn't computing what its label implied: `buildRepMaxes(1)` ranked by **raw
weight** with `isBetter(weight, reps, …)`, over a candidate pool the `reps >= 1` filter never
narrowed — the identical comparator and identical pool as `heaviestWeight`. It was an exact
duplicate of a row two lines below it. Epley appeared nowhere in that table.

So the table was replaced with a single `bestEst1rm` row that *is* Epley-estimated, and therefore
genuinely disagrees with `heaviestWeight`: 185 × 8 estimates to ~234 lb and outranks a 225 × 1
single. Both rows now earn their place — one is the most you have lifted, the other the most the
model thinks you could.

Two constraints it inherits from the weight-0 rule: bodyweight sets are **skipped** rather than
routed through `comparableLb` (a rep count would outrank pounds on any lightly loaded lift), and
the row always names the set behind the estimate — a number bigger than anything you actually
lifted reads as a bug without it.

### Why the heatmap ignores the range toggle

It renders a fixed trailing 26 weeks. Following the toggle would make the 4wk view four columns
wide (reads as broken) and the All view 260 columns (unusable on a phone). A control that produces
a broken-looking result at one of its settings is worse than no control.

Intensity uses **fixed** set-count thresholds rather than quantiles of the person's own history. A
quantile scale silently redefines what "dark" means whenever the data shifts, so neither two
people nor one person across two months can be compared — and comparison is most of the point in a
household where a dad and his sons all use the app.

It's also the only chart here not built with recharts. A day grid isn't a plot, and staying out of
recharts means it's the one Trends chart that can be asserted on for real in jsdom.

## The 2026-08-17 addition: a "?" on every chart

Every chart here answers a question that looks obvious and isn't, and the charts themselves give
no way to tell. The line chart is the worst offender: a dot is **one session**, not one day, so two
workouts in a day put two dots on the same date label — and what the dot *measures* changes with
the metric switcher, where three options are a single best set and two are session totals. Nothing
on screen distinguishes "your best set that day" from "everything you did that day", and reading
`Volume` as the former is a plausible, silent misreading of your own training history.

So each chart header carries a tappable `?` (`components/shared/ChartHelp.jsx`) that explains its
marks in plain English, and the per-metric sentence rides on the metric spec itself
(`dotMeaning` on `EXERCISE_METRICS`, `barMeaning` on `WEEKLY_METRICS`) rather than in a parallel
copy table — so it follows the same `metricSpec`/`weeklyMetricSpec` fallback as everything else,
and a new metric cannot ship without one.

Two things about it are less obvious than they look:

- **It opens on tap, not hover.** This is an iPad-in-the-gym app; hover does not exist there, and
  on iOS a hover-opened panel sticks after a tap. One mechanism covers both input types.
- **The panel's position has to be measured, not predicted.** `WeeklyMetricChart`'s header wraps on
  a phone, which moves its `?` from the card's right edge into the middle of a row — and a panel
  anchored to that trigger's right edge started 45px off the left of a 390px screen with every line
  clipped. Where the trigger lands depends on the wrap point, which varies with viewport,
  orientation and the metric's label, so `ChartHelp` measures the mounted panel and nudges it back
  on screen. jsdom computes no layout, so `trends.spec.ts`'s bounding-box test is the only thing
  that can catch a regression here.

## Deliberately not built

Scoped out on 2026-08-07, listed so the reasoning isn't re-derived:

- **Muscle-group breakdown** (sets per muscle group per week, body diagram) — the single biggest
  gap versus Hevy and Boostcamp. Needs a `muscle_group` column on `exercises`; the ~115 seeded
  exercises could be backfilled mechanically since `V34` already groups them under SQL comments.
  Note this would **re-introduce** a taxonomy deliberately dropped in `V33` in favour of free-text
  tags, so it's a decision to revisit, not just a migration to write.
- **Body-weight tracking** — small table, large unlock (bodyweight trend, relative strength, and
  making pull-ups count toward volume instead of contributing zero).
- **Workout duration** — the data exists but is not trustworthy: `ended_at` is set to `started_at`
  for `manual` sessions and to `last_activity_at` for stale-closed ones. Charting it honestly means
  filtering both cases and saying so.
- **RPE**, **strength standards / DOTS** (needs age + sex), **rest-time trends** (`rest_seconds` is
  NULL by design for first sets and non-live logging, so it's too sparse to trend).
- **A cross-person household view.** Genuinely the most differentiated thing this app could ship —
  no competitor has one, and friendly competition motivates teenagers — but it would breach the
  per-person isolation guarantee in `.claude/rules/backend-core.md`. If it's ever built it needs to
  be an explicit, documented exception: aggregate counts only, same account only, never sets or
  weights.

## Performance posture

Every number on this tab is computed in memory from a full per-person set load; there is no
SQL-side aggregation anywhere in `StatsService`. At household scale (one person, a few thousand
sets) that's fine and keeps the logic in one readable place. It does not scale to a real
multi-tenant analytics product, and the rules file's "no new full-history loads" line exists to
stop the pattern spreading further rather than to bless it. The natural next step, if a load ever
justifies it, is projection queries for the weekly buckets rather than incremental tuning.
