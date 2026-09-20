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

#### The argument applied to its own blind spot (2026-09-20)

That reasoning was applied to the three weekly measures and stopped there. Workouts-per-week was
already on the screen as `WeeklyFrequencyChart` when the switcher was built, so it was left alone —
not decided, just not revisited. It was the same card, the same height, the same accent bar, the
same Monday buckets, reading a sibling field (`workoutCount`) off the very same `overview.weeks`
rows the switcher's three metrics read. Two adjacent bar charts that differ only in which column
of one row they plot are one chart with a control on it, and the "one chart's worth of vertical
space" argument above applies to the fourth series exactly as it did to the other three.

So it is now `WEEKLY_METRICS.workouts`, and it is the **default** — it is what the tab opened on
before the merge, and "did I show up" is the read this household opens Trends for. A persisted
`volume`/`sets`/`reps` preference still resolves, so the change costs nobody a setting; the
`PERSON_DEFAULTS` underlay in `AppStateContext` is what makes moving a default safe at all
(see `.claude/rules/frontend-core.md`).

Two things the merge had to carry rather than drop:

- **The `?` copy.** `WORKOUT_FREQUENCY_HELP`'s sentence about a bar being *sessions, not exercises
  and not sets* became that spec's `barMeaning`, so it reaches both the in-app `?` and the
  handbook's table by the ordinary route. The Trends `?` count went from four to three.
- **Its generic first line.** `weeklyMetricHelp` opened with *"One bar per week, starting Monday,
  adding up every exercise you did that week"* — true of volume, sets and reps, false of workouts,
  which counts sessions and does not care how many exercises are in them. That clause moved down
  onto the three `barMeaning`s that own it.

What did *not* move up into a shared line: the tooltip's singular/plural. A week with one session
is the most common bar this chart draws, and the old standalone chart said "1 workout" while the
switcher's tooltip lowercases the option label — which would have read "1 workouts". `countNoun`
in `weeklyMetrics.js` fixes it for all three count metrics ("1 sets" was already wrong, just
rarer).

##### The fourth pill did not fit, and the first test said it did

Three pills shared the card's header row with the `?` and fit a phone. The fourth pushed that pair
to ~334px against a 303px row at 375px — and because `.seg` is `inline-flex` with `flex-shrink: 0`,
`white-space: nowrap` items, it does not wrap or compress. It overflows. The visible symptom was
the `?` sitting **outside the card's right border**, with the page gaining a horizontal scrollbar
at 375px and 320px.

The e2e test written alongside the merge did not catch it, and the reason is worth keeping: it
asserted the group stayed within the **390px viewport**, which was true the whole time. The
container that was violated was the card. A geometry assertion has to name the box the element is
supposed to be inside, and the viewport is almost never that box. It now measures against the
card's own padding box, at 320/375/390/393/402/430, and asserts the four pills share one line —
`.seg-fill` is permitted to wrap (that is what rescues the 5-pill exercise switcher), so a
two-and-two split is a legitimate CSS outcome and therefore has to be asserted against rather than
assumed away.

##### …and the second version of that test failed on lower, for a different reason worth keeping

Rewritten to measure the card, it passed all six widths locally and then failed `e2e-tests` on
lower at **320px only**: the four pills split across two lines. Nothing about the change was
wrong — the *font* was different. The app's stack is `-apple-system, BlinkMacSystemFont, 'SF Pro
Text'`, which on every non-Apple platform falls through to a substitute, and the Linux CI runner's
substitute is wider than the Windows dev machine's. The test had been asserting a layout budget
against whichever font the runner happened to have, which is not asserting it at all.

Two things came out of that:

- **The control got its side inset back.** The toggle row had inherited the title row's `0 8px`
  padding, which at 320px is ~7% of the usable width for no reason — the chart body below it is
  already full-bleed to the card's padding. Removing it is worth ~16px exactly where the budget
  is tightest.
- **The claim is now asserted under `letter-spacing`, and scoped by width.** Letter-spacing adds a
  fixed number of pixels per character whatever the face, so it reproduces across platforms in a
  way a named font does not — and notably, the obvious trick of borrowing `sticky-chrome.spec.ts`'s
  `"Times New Roman"` tag would have made this test *weaker*, because that serif is **narrower**
  here than the Windows default sans. Measured headroom: **375px survives 3px/char; 320px wraps
  between 1.5 and 2.** So one-line is asserted from 375px up — the narrowest iPhone portrait Apple
  still ships — under a 2px/char widening, and 320px (the 2016 SE, discontinued 2018) keeps only
  the assertion that actually matters there: nothing overflows the card. Wrapping to two rows on
  that device is graceful and legible; overflowing would not be.

The general form: **when a layout assertion depends on text metrics, it has to state the margin it
is claiming and force that margin deterministically.** Otherwise the first environment with a
different font decides whether the test passes.

The fix is the one `SegmentedToggle`'s own header already prescribed — `fill`, past ~3 options —
which trades the intrinsic 16px pill padding for `.seg-fill`'s 4px and puts the control on its own
full-width row. That also makes it match the five-pill exercise switcher directly beneath it, which
had been solving the same problem the same way since #139. Worth noting the *reason* it was missed:
the guidance lived in the component being reused, not in the calling site being edited.

One thing this moved without breaking: the Trends `?` buttons no longer sit in a wrapping header,
which is the case `ChartHelp`'s measure-and-nudge effect was built for. The effect stays — see
`.claude/rules/trends.md` — but its live trigger on this screen is gone, so a future wrapping
header is what would re-arm it.

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

## The est.-1RM rep cap

Epley (`weight x (1 + reps/30)`) is unbounded in reps, and that made the est.-1RM record gameable
in a way that mattered: `135 x 30` estimates to 270 lb and takes the record off a genuine `225 x 3`.
Sports-science validity for any 1RM formula runs to roughly 10-12 reps; past that it is
extrapolation presented as a number.

`EpleyCalculator.EST_1RM_REP_CAP` is **12**, applied by clamping reps before the formula, and
mirrored in `utils/formulas.js#epley`.

**Clamping, not excluding.** The alternative — dropping sets above the cap from candidacy — was
rejected for two reasons. It creates a cliff where a 12-rep set counts and a 13-rep set vanishes,
so somebody's hardest set is the one missing from the board with no explanation. And it makes the
measure non-monotonic from the user's point of view: doing one more rep could remove your record.
Clamping keeps "more reps never hurts you, it just stops helping", which is the only version of
this anyone can reason about mid-workout.

**Not applied at weight 0.** `comparableLb` returns the raw rep count for a bodyweight set, and
that count *is* the record — capping it would tie every pull-up set above 12 forever, which is the
exact failure the weight-0 branch exists to prevent.

The change is retroactive: it rescores every historical set, and a record set by a very high-rep
set moves. That was the intent, and it is stated to users in the handbook rather than left to be
discovered.

## A session-level record names the work behind it

"One session" was the entire caption for the Volume and Reps records, because `PrMeasureDto` sent
`weightLb`/`reps` as null for a session-level measure — correctly, since no single set is the
answer. But the number alone was unreadable: nothing distinguished a genuine heavy day from ten
junk sets of an empty bar.

That is not only a legibility problem. A volume record is the one measure that can be inflated by
padding a workout with meaningless sets, and the cheapest defence against that is not a rule — it
is showing the work. `4 x 45lb x 10` is self-evidently not a training record; `135lb x 10, 3 x
155lb x 8` is. The breakdown makes the record self-policing, which is why it was preferred over
capping set counts or weighting sets by intensity, both of which would have distorted a number
people also read on the Trends chart.

`PrSetDto` collapses consecutive identical sets into runs with a `count`, which is both how the
payload stays small and how a person reads their own workout. It is capped at six runs server-side
and three client-side with an honest `+N more` — counting **sets**, not runs, so a single collapsed
run of eight cannot understate the work.
