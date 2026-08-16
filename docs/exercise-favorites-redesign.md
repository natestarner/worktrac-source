# Exercise Favorites Redesign — Decision Log

Rationale behind the exercise-model rebuild on branch `feat/exercise-favorites-overlay`. This
records **why** the decisions were made, so future work doesn't re-litigate them. It is a
decision log, not a how-to.

## Why this change

The old model shipped a fixed set of "system" exercises (rows with `account_id IS NULL`) that
were **eagerly loaded and listed in full** on every screen (Log, New Routine, App Settings),
alongside account-created ones. Customizing a system exercise meant **fork-on-write** (editing
it silently cloned an account-owned copy and re-pointed the household's logged sets). As the
catalog grows this dump-everything approach doesn't scale, the system-vs-user distinction
confused users, and the fork machinery was the riskiest code in the app (it mutates logged
history).

Goal: make the catalog **searched, not dumped**; let each **person** curate what they see by
**favoriting**; and personalize exercises without ever mutating shared rows or logged history.

## The model we landed on

- **Log picker** shows only a person's own list — their **favorites ∪ previously-logged**
  exercises — grouped under **"Favorites"** and **"Other Previously Logged"**. The full
  catalog is reached by **search**. Plain pills (no per-pill star); favoriting happens on the
  exercise screen.
- **Favoriting is per-person**, a lightweight pointer (`person_exercise`). It never copies the
  exercise row.
- **Preloaded ("system") exercises are immutable** — you favorite them or not. To customize,
  you personalize (below) or add your own. Editing/deleting a global is rejected (403).
- **Personalization is a per-person overlay** that never touches the shared exercise row:
  a per-person **category** assignment and per-person **custom setup fields** (values stored
  inline on the overlay row, so the shared `setup_values` table is untouched).
- **Categories are per-person, user-created.** Exercises ship **uncategorized**
  (`exercises.category_id` made nullable); a person builds their own categories and files
  exercises into them. "Recommendations" = the seeded global category names, offered as
  one-tap starters. (**Superseded 2026-07-17 — see the update entry at the bottom: categories
  are replaced by shared, free-text, many-to-many tags.**)
- **Only user-created exercises can be renamed/deleted**, and that happens on the exercise's
  own screen — the ⚙ **"Customize this exercise"** modal — which shows a **"Created by you"**
  vs **"Preloaded exercise"** badge so it's obvious why the option is/ isn't there.
- **App Settings has no exercise UI** — just a per-person category manager, units, and export.
  Creating a custom exercise lives on the Log picker / routine modal ("+ Add your own
  exercise"), always available (no search required); it auto-favorites on create.

## Key decisions & rationale

- **Favorites are per-person, not per-household.** → Matches the app's core rule that each
  person's in-progress state and data are separate; one person's list shouldn't clutter
  another's.
- **A favorite is a pointer, not a copy.** → You don't need a private row just to have quick
  access to something. Copying would proliferate near-identical rows and, combined with
  per-person favorites, would force per-person exercise ownership (a much bigger change).
- **Retire fork-on-write; preloaded exercises are immutable.** → Forking existed only to let a
  household privately rename/hide a shared exercise. In the favorites model, "hide" = don't
  favorite, and "customize" = the overlay or "add your own" — so the risky history-re-pointing
  is no longer needed. Existing forked rows are kept as valid personal exercises; nothing new
  ever forks.
- **Personalization as a per-person overlay (category + custom fields).** → Achieves "make
  this mine" without mutating the shared row or logged sets. Per-person storage lets custom
  field values live inline, so we never touch the sensitive `setup_values` table.
- **Pure user categories; exercises ship uncategorized.** → Don't impose a shared taxonomy;
  let people organize their own picker. The seeded global categories survive only as
  recommendation names. `category_id` is made nullable rather than dropped (non-destructive).
- **Client-side search for now.** → The catalog is small/lightweight enough that loading it
  once and filtering client-side is simpler than a search endpoint. Threshold to go
  server-side: low-thousands of rows, or media/metadata-heavy rows, or ranked/fuzzy search.
  Built behind the hook/API layer so a `GET /api/exercises/search` can drop in later.
- **Auto-favorite on create and on routine-add.** → An exercise you just made or put in a
  routine should appear in your picker without a separate step. This is also what makes the
  three "show in Log" cases collapse to just favorites ∪ logged.
- **Rename/delete only on user-created exercises, on the Customize screen.** → Object-centric:
  everything about an exercise lives on its own screen. Deletes/renames are rare and always
  reachable via search, so a slightly deeper path is fine — and it lets App Settings drop the
  redundant exercise list entirely.

## Explicitly rejected / deferred

- **Rename/delete of *any* exercise via fork-or-re-point (per-person).** Considered letting
  users rename/delete system exercises too, by forking a personal copy and re-pointing their
  logged sets (merging on a name collision). **Rejected** because it re-introduces the exact
  logged-set re-pointing we removed (history/PR integrity risk) and would either pollute the
  shared household catalog or require making exercises person-scoped. If ever revisited, the
  safer path is a per-person **display-name + hidden** overlay (alias/hide) that never mutates
  logged data — same end-user result, no re-pointing. Not built.
- **Trends "category balance" chart** still keys off the legacy shared category (muscle group).
  Null-guarded so uncategorized user exercises fall under "Uncategorized" instead of crashing,
  but it does **not** yet reflect per-person categories. Flagged for future rework.
- **Base vs. overlay setup fields on your own exercises.** A user-created exercise can carry
  base fields (from creation) *and* per-person overlay fields; both render identically as
  value pills. Accepted as a minor, invisible-to-user wart rather than special-casing it.
  (**Superseded 2026-07-16 — see the update entry at the bottom: shared "base" setup fields
  (System A) were removed; all setup fields are per-person now, so the wart is gone.**)

## Data model & migrations

New tables (Flyway V19–V24):

- `person_categories` — per-person, user-created categories.
- `person_exercise` — the per-person overlay row: `is_favorite` + `person_category_id`
  (favorite state + category filing), one per (person, exercise).
- `person_exercise_fields` — per-person custom setup fields (value stored inline).
- `exercises.category_id` made **nullable** (exercises ship uncategorized).
- Backfills: seed each person's categories from their account's existing categories; favorite
  every exercise already in a routine (so existing routines/logged exercises keep showing).

The old `forked_from_id` column and any existing forked rows are kept for historical data but
are never triggered again. Logged sets, history, PRs, and exports are untouched by all of this.
(**Superseded 2026-07-16 — see the update entry at the bottom: the `forked_from_id` column and
the whole fork-on-edit code path have now been removed.**)

The PR board and Trends stopped surfacing the legacy per-exercise category and were made
null-safe (user-created exercises have no base category).

## Status

- Branch `feat/exercise-favorites-overlay`.
- Backend `mvn verify` green, including `ExerciseFavoritesTest` (favorite isolation across
  people/accounts, logged-shows-in-picker, custom-field isolation, category filing,
  recommendations, routine auto-favorite, global edit/delete rejected, PRs safe for
  uncategorized exercises) and all pre-existing suites.
- Frontend build, lint, and tests green.

## Update — 2026-07-16: fork-on-edit machinery removed (V25)

The favorites rebuild retired fork-on-edit but deliberately *kept* the `forked_from_id`
column and the re-pointing helpers around for historical data (see the note in "Data model &
migrations"). They were never triggered again — nothing ever set `forked_from_id`, so it was
`NULL` on every row and the visibility query's exclusion subquery was a permanent no-op.

That dead scaffolding has now been removed (behavior-preserving):

- **Migration `V25__drop_forked_from_from_exercises.sql`** drops the
  `IX_exercises_forked_from_id` index, the `FK_exercises_forked_from` FK, and the
  `forked_from_id` column.
- `Exercise.forkedFrom` (+ getter/setter) removed; `ExerciseRepository.findVisibleToAccount`
  simplified to "every global exercise ∪ this account's own."
- The unused fork re-point helpers removed:
  `SetupValueRepository.findByField_IdAndPerson_IdIn` + `SetupValue.setField`,
  `WorkoutSetRepository.findByPerson_IdInAndExercise_Id` + `WorkoutSet.setExercise`,
  `RoutineExerciseRepository.findByExercise_IdAndRoutine_Person_IdIn` +
  `RoutineExercise.setExercise` (all had zero callers).

Rationale: with more people onboarding, keep `main` lean — dead history-re-pointing code is
exactly the kind of risky-looking scaffolding worth deleting once it's provably unreachable.

## Update — 2026-07-16: setup fields are now per-person only (V26–V28)

The original model kept **two** setup-field systems side by side: shared field *names* on the
exercise (`exercise_setup_fields`, seeded for the 14 system exercises) with per-person *values*
in `setup_values` ("System A"), plus fully per-person fields with name+value inline on the
`person_exercise` overlay (`person_exercise_fields`, "System B"). The two rendered identically
as pills (the "wart" above), and two different modals each wrote to a different store.

That is now collapsed to **one system: all setup fields are per-person** (System B). Rationale:
with more people onboarding, one clear model ("your fields on your exercises") beats a hidden
shared/overlay split; it removes a whole table, DTO field, and editor modal.

- **Migrations:** `V26` back-fills every entered `setup_values` row into
  `person_exercise_fields` (creating the `person_exercise` overlay row as needed, preserving
  name/value/sort order) so no real data is lost; `V27` drops `setup_values`; `V28` drops
  `exercise_setup_fields`. Seeded base-field *names* a person never entered a value for are
  intentionally not carried over.
- **Backend:** deleted the `setupvalue` package and `ExerciseSetupField*`; removed
  `Exercise.setupFields`, `ExerciseRequest.setupFieldNames`, and `setupFields` from
  `ExerciseDto`/`PersonExerciseDto`; account-deletion now cascades via
  `person_exercise/person_exercise_fields`.
- **Frontend:** deleted `api/setupValues.js` and the System-A `SetupFieldEditorModal`; removed
  the base-field section from Add/Edit exercise and the System-A pills + fetch from
  `ExerciseDetail`; the per-person fields (still on the `.../custom-fields` endpoints) are the
  only setup-field UI.
- Backend `mvn verify` (87 tests) and frontend Vitest (98 tests) green.
- **Deferred:** renaming the per-person `/custom-fields` endpoints to `/setup-fields` (pure
  cosmetics, larger cross-stack ripple) — left for a follow-up.

## Update — 2026-07-17: categories replaced by tags (V29–V33)

Per-person categories (a single category per exercise) were too rigid — a Romanian deadlift
is legs *and* hamstrings *and* a hinge. Categories are replaced by **tags**: a shared,
per-account, free-text vocabulary applied to exercises **many-to-many**, per person.

Decisions:
- **Shared vocabulary, per-person assignment.** Tags belong to the account (everyone picks
  from the same free-text set — `GET /api/tags`), but which exercises each *person* tags stays
  per-person (`person_exercise_tags`). Consistent with the app's per-person overlay model.
- **Free-text, created on the fly.** Applying a tag by a name that doesn't exist yet upserts
  it into the account vocabulary (`TagService.getOrCreate`, case-insensitive de-dup via DB
  collation). No curated list, no "recommendations".
- **Both category systems removed.** The legacy account/global `categories` taxonomy AND the
  per-person `person_categories` are dropped — tags fully supersede them.
- **Trends "category balance" chart removed** (it keyed off the legacy category; a set can now
  belong to multiple tags, which breaks the 100%-stacked framing). CSV export's old "Category"
  column (which also had a latent NPE) becomes a per-person **"Tags"** column.

Migrations: `V29` creates `tags` (account-scoped, `UNIQUE(account_id, name)`); `V30` creates
the `person_exercise_tags` join (both FKs cascade); `V31` back-fills tags + assignments from
`person_categories`; `V32` drops `person_categories`; `V33` drops `exercises.category_id` +
the legacy `categories` table. Backend `mvn verify` (84 tests) and frontend Vitest (98 tests)
+ build green.

Rationale for the whole three-part cleanup (fork removal, setup-fields → per-person, tags):
onboarding more household members meant lock-in on a lean, single-model data layer with no
dead scaffolding.

## Update — 2026-07-17: system exercise library expanded 15 → 111 (V34)

The original 15 seeded system exercises (V7/V16) were too sparse to be useful once the
favorites/search model above shipped — the whole point of "searched, not dumped" only pays
off with a catalog worth searching. `V34__expand_system_exercise_library.sql` grows the
shared (`account_id IS NULL`) library to 111 entries at the same naming granularity already
established (equipment/variant prefix + movement, e.g. "Barbell Bench Press" vs. "Dumbbell
Incline Bench Press"), including a proper set of dedicated machine variants the original
seed was missing almost entirely (Machine Chest Press, Smith Machine Squat, Assisted Pull-up
Machine, etc.).

Two existing entries were renamed to disambiguate from new siblings, following the same
precedent V16 set: `Tricep Pushdown` → `Cable Tricep Pushdown`, `Deadlift` → `Barbell
Deadlift`. Both renames are scoped to `account_id IS NULL`, so any household that already
forked/personalized one of these keeps its own copy untouched — consistent with "preloaded
exercises are immutable" above (this only touches the shared row's display name, not any
person's overlay).

Sourcing decision: hand-curated rather than imported from an external exercise database
(e.g. `free-exercise-db`) — the existing names follow a specific convention an imported
dataset would need heavy renaming to match anyway, and the schema no longer carries
category/muscle-group metadata (dropped in V33) for such a source to populate.

Pure data migration — no schema, API, or frontend changes. Backend `mvn verify` (84 tests)
green.

## Update — 2026-07-17: forgiving, ranked search + a distinct results list

With the catalog now at 111 entries (see previous update), the original exact-substring
matcher (`name.toLowerCase().includes(term)`) was too strict: it's word-order sensitive, so
`"barbell squat"` didn't match `"Barbell Back Squat"` even though both words are present.
Results also rendered as the same wrapped-chip layout used for the Favorites/Other
Previously Logged sections, making curated picks and search matches hard to tell apart.

This directly touches the **"Client-side search for now"** decision above, which named
"ranked/fuzzy search" as one trigger for going server-side. Decision: **stay client-side.**
Ranking is a pure sort over an already-in-memory array of 111 rows — negligible cost — so the
threshold that decision meant to guard against (query latency/complexity at a much larger
scale) isn't in play yet. Revisit if the catalog grows another order of magnitude or the
matching logic needs data (e.g. muscle group/equipment) that isn't already client-side.

Changes:
- `frontend/src/utils/exerciseSearch.js` — new shared matcher: splits the query into
  whitespace tokens and matches if every token appears anywhere in the name (order-
  independent), ranked exact-prefix > contiguous-substring > scattered-tokens. Replaces the
  logic duplicated between `ExercisePicker.jsx` and `RoutineFormModal.jsx`.
- `frontend/src/components/shared/ExerciseSearchResults.jsx` — new shared component:
  search results now render as a single-column list (one exercise per row, matched text
  highlighted), visually distinct from the chip-based Favorites/Other Previously Logged
  sections. Used by both the Log picker and the routine builder's exercise search.
- Frontend Vitest (incl. new `exerciseSearch.test.js`) and Playwright e2e (incl. a new
  reordered-query case) green.

## Update — 2026-08-06: search/tags UX on History and PRs, plus a picker-membership bug fix

Added tag display + search/tag filtering to the History and PRs tabs, PR-at-the-time markers
in History, click-to-filter from a History row or PR row, a "View full history" deep link from
the exercise detail screen into filtered History, and per-tab ephemeral filter state that
clears on navigate-away/person-switch. All client-side/frontend — no schema or API changes for
this part. New: `frontend/src/components/shared/ExerciseFilterBar.jsx`,
`frontend/src/hooks/useExerciseFilter.js` + `useExerciseTagMap.js`,
`frontend/src/utils/exerciseFilter.js` + `historyPrFlags.js`.

While testing that feature, found and fixed a real bug in **this decision log's own core
mechanism**: the "picker = favorites ∪ previously-logged" model above was quietly out of date
even before this PR — it had already grown two more union terms (noted, per the 2026-07
persistent-note work) that were never reflected here, and this PR's testing surfaced that
**tags and custom setup fields never got the same treatment when they shipped**, so
`PersonExerciseService.listForPerson` was still only checking favorite/note/logged.
Practical effect: tagging (or adding a custom field to) an exercise you'd never
favorited/logged/noted applied successfully server-side but could never be displayed anywhere,
permanently — not a refresh-timing issue, the exercise genuinely never entered the one list
that carries tags to the frontend. Fixed by adding `!pe.getTags().isEmpty()` and
`!pe.getCustomFields().isEmpty()` to that union. Full root-cause narrative and the general
"any future personalization field needs this too" rule: CLAUDE.md's 2026-08-05 Resolved
Incident entry.

**Corrected statement of the rule** (supersedes "favorites ∪ previously-logged" above and the
2026-07 note-only update that partially corrected it): a person's Log picker =
**favorited ∪ noted ∪ tagged ∪ has-a-custom-field ∪ previously-logged**. Any new per-person
personalization field added to `PersonExercise` in the future must join this union too, or it
will reproduce this exact bug.

Backend `mvn verify` (186 tests, incl. 4 new picker-membership cases in
`ExerciseFavoritesTest`), frontend Vitest (558 tests, 61 new/changed), and Playwright e2e (67
specs, incl. a new `history-filter.spec.ts` and a regression case that deliberately tags
before ever logging) all green.

## Update — 2026-08-07: Trends expanded; the category-balance chart stays gone

Trends grew from 3 stat tiles + 2 bar charts + 1 est.-1RM line into rep-max records, a
per-exercise metric switcher (Est. 1RM / Top weight / Volume / Best set / Reps), a weekly
Volume/Sets/Reps switcher, a consistency heatmap, and a recent-PRs card. No schema change —
everything is derived from sets already stored. Full narrative: `docs/architecture/trends.md`;
invariants: `.claude/rules/trends.md`.

**This does NOT revisit the 2026-07 decision above to remove the "category balance" chart.** That
chart was dropped because it keyed off the legacy `categories` taxonomy, and because a set can now
carry multiple tags, which breaks a 100%-stacked framing. Nothing here reinstates it, and the
`--chart-cat-*` categorical palette in `index.css` remains unused. Its natural successor is a
muscle-group breakdown (the biggest remaining gap versus Hevy/Boostcamp), which was **deliberately
scoped out** on 2026-08-07: it needs a `muscle_group` column on `exercises`, and it would
re-introduce a structured taxonomy that `V33` deliberately dropped in favour of free-text tags.
That's a decision to revisit on its merits, not a migration to write casually. The other scoped-out
items — body-weight tracking, workout duration, RPE, and a cross-person household view (which would
breach per-person isolation) — are recorded with their reasoning in `docs/architecture/trends.md`.

Two pre-existing bugs were fixed along the way: logging a set never invalidated the trends query
caches (only `prs`/`history`), so with `staleTime` at 60s a first-ever set left Trends reading "No
workouts logged yet"; and the range-empty state showed onboarding copy to anyone whose *selected
range* was empty, telling a lapsed user with years of history they had never trained.

Backend `mvn verify` (205 tests), frontend Vitest (615 tests), and Playwright e2e (72 specs, incl.
a new `trends.spec.ts`) all green.

## Update — 2026-08-08: two of yesterday's Trends additions walked back; PRs board gets a sort

The 2026-08-07 entry above added five things to Trends. Two of them turned out to be duplicating
surfaces that already existed, and are now removed. That entry stands as written — this is what
changed since, not a correction of it.

**Recent PRs is gone.** Its rows repeated the PRs board row-for-row: same exercise, same
weight × reps, same date. That wasn't a rendering accident — a PR set in the last 30 days *is*
that lift's all-time best, so the two lists are the same rows by construction. The card's one
genuinely distinct piece of information, the delta versus the previous best, was never displayed.
Rather than teach it to show deltas, the question moved to the board as an ordering: "what got
better lately" is a *sort* of the PRs you already have, not a second list of them. `buildRecentPrs`,
`RecentPrDto` and `TrendsOverviewDto.recentPrs` went with it.

**The rep-max table is gone, replaced by one Epley-based "Best est. 1RM" row.** The intent was to
keep just the 1RM and drop 3/5/8/10/12. Reading the code first showed the "1+ reps" row wasn't a
1RM at all: `buildRepMaxes(1)` ranked on **raw weight** using the same `isBetter(weight, reps, …)`
comparator over a candidate pool its `reps >= 1` filter never narrowed — byte-for-byte the same
record as `heaviestWeight` two rows below it. Epley appeared nowhere in that table. The replacement
row genuinely disagrees with `heaviestWeight` (185 × 8 → ~234 lb beats a 225 × 1 single), skips
weight-0 sets rather than routing them through `comparableLb`, and always names the set behind the
estimate so a number above your best actual lift doesn't read as a bug.

**The PRs board is now sortable** — Most recent (default), Name A–Z, Best est. 1RM — stored per
person in `AppStateContext` alongside the Trends metric switchers, so it survives a person switch.
That is deliberately different from the *filter* beside it (`useExerciseFilter`), which is local
state and clears on navigate-away by design: a sort is a standing preference, a filter is not.
Sorting by est. 1RM normalizes to lb before ranking (raw `est1rm` arrives in each set's own unit, so
a mixed-unit history would compare 100 kg against 200 lb numerically) and groups bodyweight lifts
last instead of letting them all tie at 0.

One behaviour worth knowing: "Most recent" orders by the PR's **session** `startedAt`, so several
PRs set in the same workout tie exactly and fall through to a name tiebreak. That matches how the
row itself is dated and keeps the order deterministic; it is not a bug.

Also fixed here: hovering the weekly volume chart blanked the entire page for anyone whose persisted
UI state predated the 2026-08-07 metric switcher. Full post-mortem in
`docs/incidents/2026-08-08-trends-hover-blank-page.md` — the general fix (`HYDRATE` now underlays
`PERSON_DEFAULTS`) matters more than the chart fix, because without it every future field added to
`PERSON_DEFAULTS` carries the same latent crash for existing users.

Backend `mvn verify` (203 tests), frontend Vitest (641 tests), and Playwright e2e (74 specs) green.

## 2026-08-09 — Design system pass

The frontend was ~95% inline `style={{}}` objects with a colour-only token layer. Type, space,
shadow and motion were hardcoded at every call site, which is how 17 font sizes, 13 border radii,
8 one-off shadows and ~40 padding pairs accumulated — and `fontWeight: 700` appeared 132 times
against `400` three times, so nothing on screen had emphasis because everything did.

More consequentially, **inline styles cannot express `:hover`, `:active` or `:focus-visible`**, so
the app had no transitions, no press feedback, and no keyboard focus indicator anywhere. That was
an architectural dead end, not an oversight. This pass adds the missing token families plus a CSS
component layer (`.btn-*`, `.card`, `.input`, `.seg`, `.icon-btn`) and a small set of React
primitives, and migrates everything except the admin portal and the Recharts internals.

Five measured contrast failures fixed: `--color-muted` (4.42:1), `--color-faint` (2.07:1, and it
was carrying empty-state body copy), and dark-mode `--color-success`/`--color-danger`, which were
never re-derived for the dark theme and sat at ~3.3:1. The accent split into three tokens because
`#d4673e` is 3.44:1 as small text — the hero "Log set" CTA keeps the brand orange only because it
is large enough to qualify as AA Large. Full reasoning in `docs/architecture/design-system.md`.

**Decision worth recording: not every glyph became an icon.** Emoji did (they ignore the theme and
the accent colour, and render as different art per OS), but the `+` in "+ Add person", the
stepper's `+`/`−`, the keypad's `⌫` and the back arrow stayed as text — they render identically
everywhere, inherit colour and weight, and were never the problem. They are also part of those
controls' accessible names, which ~30 e2e assertions select by. Similarly, dimming the unit in
`135 lb × 8` was tried and reverted: it requires splitting the string into spans, and RTL's
`getByText` concatenates only direct text-node children, so ~20 assertions covering offline set
handling and PR-badge correctness would have broken for a subtle typographic gain.

**Toasts are neutral, not green.** The saturated success green was the one hue in the palette with
nothing else to talk to. A confirmation doesn't need colour to carry its meaning; errors do, so
they keep a hue — with their own bg/text pair, because dark-mode `--color-danger` is a light salmon
tuned to be read *as text* on a dark ground and white on it is only 2.95:1.

## Update — 2026-08-10: routines may repeat an exercise; modals stop closing on a stray tap; the 45 lb default retired

Four unrelated papercuts, batched because they were reported together.

**A routine may list the same exercise more than once.** Routines are meant to walk you through a
whole workout, and plenty of workouts cycle back — bench, row, bench. That was unbuildable, and the
reason was a single predicate in `RoutineFormModal.jsx` (`unselected`) that filtered an exercise out
of the picker the moment it was added. Nothing else forbade it: `routine_exercises` has no unique
index on `(routine_id, exercise_id)`, `RoutineService#attachExercises` numbers `sort_order` straight
from list position with no dedupe, and the in-workout stepper (`routineIndex`,
`JUMP_TO_ROUTINE_INDEX`, the pill strip's `key`) was already index-based throughout.

Decision worth recording: **the builder's contents are now a list of occurrences
(`{ key, exerciseId }`), not a set of exercise ids.** Remove, reorder and React keys each have to
address one *position* — keying on the exercise id made "remove" delete every copy at once. The
backend was left alone, but now has a test asserting `[1, 1, 2]` round-trips as three ordered rows,
so "there happens to be no unique index" is a guarantee rather than an accident someone tidies away
later.

**Modals never close on a backdrop tap.** The app is used one-handed on an iPad mid-set, where a
stray thumb on the scrim discarded a half-built routine or an unsaved note with no confirmation and
no undo. `Modal` now owns a sticky header carrying the title and an X, and one `onClose` prop drives
both that and Escape. Three things this settled:

- **Escape stays.** Backdrop and Escape were the same handler, so removing outside-click would have
  removed Escape with it — and `Modal` installs a focus trap, making Escape the only keyboard exit.
  Unlike a mis-tap, it is never accidental, and it is moot on the iPad where the problem lives.
- **The header had to be sticky.** The panel is `max-height: 80vh` with its own scrollbar and the
  routine builder is taller than that; an X that scrolls out of reach is what would make this feel
  like a trap rather than a safeguard.
- `PRCelebration` is deliberately **not** a `Modal` and keeps click-anywhere — it is a transient
  celebration, not a form, and eight e2e specs dismiss it that way.

Passing `title` also wires `aria-labelledby`; before this only `ConfirmDialog` labelled its dialog at
all. `OutboxModal`'s footer button became "Done" because the X's accessible name is "Close" and two
same-named controls in one dialog is a strict-mode violation.

**The 45 lb prefill is gone.** An exercise with no history now prefills *blank* (an em dash), not a
number. 45 was right only for a barbell and wrong for every machine, dumbbell and bodyweight lift — a
first-ever pull-up made you dial it down to 0 every time.

Decision: **blank is a display state, not a validation gate.** Tapping "Log set" with it untouched
logs 0, which is exactly right for a pull-up or plank, and 0 already means "bodyweight" everywhere
downstream (`comparableLb`, `prSort.isBodyweight`, the backend's `bodyweightOnly`). Requiring an
explicit entry was considered and rejected: it punishes the bodyweight case to protect a weighted one
where the em dash is already visibly not a number. A name-parsing "Barbell … → 45" heuristic was also
rejected — it leans on a naming convention custom exercises are under no obligation to follow.

Two consequences fell out of it:

- **Prefill now carries today's last set forward** when there is no prior session. Without that, a
  brand-new exercise re-seeded to blank before *every* set of its first workout — worse than the 45
  it replaced. It reads `displaySets`, not `sessionSets`, or it would work online and silently do
  nothing for a person's entire offline stretch; `parity-active-loop.spec.ts` asserts it across all
  four connectivity modes.
- **The keypad's first keypress replaces the value** instead of appending. Tapping a prefilled 135
  and typing 225 used to give you 135225, so every exact entry began by backspacing the prefill out.

**The routine strip's scrollbar is thick and always visible.** Worth recording the trap: setting
`scrollbar-width` **disables** `::-webkit-scrollbar` in Chrome, which silently reverted the whole rule
to the platform default — and the first attempt asked for 10px, *thinner* than Chrome's 15px default.
The standard properties now live in an `@supports not selector(::-webkit-scrollbar)` block for
engines that lack the pseudo-elements. Styling it at all also switches iOS/iPadOS Safari from an
overlay scrollbar to a persistent one, which is the actual fix: an overlay bar is invisible until you
already know to swipe.

## Update — 2026-08-10 (later the same day): the custom on-screen keypad is gone

Superseded the "keypad's first keypress replaces the value" bullet above. Tapping the weight or
reps value opened `NumericKeypad`, a bespoke modal number pad — including on desktop, where
clicking into a field and having an on-screen keypad slide up is not how any other input on the
web behaves. It existed for exactly one reason, and that reason didn't actually require it.

**The reason:** the field opens pre-seeded with a carried-forward value (see the prefill section
above), and a plain `<input>` puts the caret at the *end* of existing text, so typing a
replacement appends instead of replacing it — tap a prefilled 135, type 225, get 135225.
`NumericKeypad` solved this with a manual "fresh buffer" flag: the first keypress replaced the
buffer outright, every keypress after that behaved normally.

**The fix that made the keypad unnecessary:** `WeightRepsStepper`'s value is now a real
`input[inputMode=decimal]` that calls `.select()` on focus. Selecting the existing text means the
first keystroke replaces it automatically — the same "replace, don't append" behaviour, supplied
by the platform instead of hand-rolled. Mobile still gets a numeric keyboard (the OS's own, not a
bespoke one); desktop gets an ordinary text field with its text highlighted, no overlay.

The input commits on blur/Enter rather than on every keystroke, which is a smaller version of the
same problem: a plain controlled input re-renders with the *parsed* value on every change, which
strips a trailing "." the instant it's typed and makes a decimal impossible to enter digit by
digit. `WeightRepsStepper` buffers the in-progress text in local state while focused and only
calls back to the parent on blur — mirroring the old keypad's explicit "Done", minus the modal.

Swept up in the same change: `EditSetModal` used the same stepper component for its weight/reps
rows but never wired up the tap-to-edit affordance at all, so correcting a set there meant mashing
`+`/`-` one click per unit with no way to type an exact number. It gets the same input for free,
since both screens share the one component.

`IconBackspace` (`icons.jsx`) and the whole `NumericKeypad.jsx`/`.test.jsx` pair are deleted
outright rather than left unused — the icon was already dead code before this (the keypad's
backspace key was the literal glyph `⌫`, not this icon), and nothing else ever referenced it.

## Update — 2026-08-13: the weight/reps draft is stamped with the exercise it belongs to

Two bugs, one cause. The draft (`weightDraft`/`repsDraft`) is **per-person** state living in
`AppStateContext` — mounted above the router — describing a **per-exercise** value the person may
also have typed by hand. It carried no record of any of that, so nothing could tell a stale
suggestion apart from what someone had just entered.

**Switching exercises painted the previous exercise's numbers** until the new exercise's summary
resolved: one frame when cached, a full round trip when not, the whole `retry: 2` window under
lie-fi. Both navigation paths hit it — the picker unmounts `ExerciseDetail` (`LogTab` renders it
under `selectedExercise &&`) and the routine strip swaps the prop without unmounting, but the draft
outlives both. `key={exercise.id}` fixes neither and would break the routine path's index-based
stepping.

**A late re-seed could overwrite a weight the person had typed**, and the set was then logged at the
prefill. The effect re-fired on any change to `summary` identity or `displaySets.length` — including
the window-focus refetch that `summaryQuery`'s `staleTime: 0` guarantees, which mid-workout on an
iPad is routine rather than exceptional. Known since 2026-08-08 and worked around in the e2e helpers
instead of fixed; full post-mortem in
`docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md`.

Decision: **the draft carries a stamp** — `draftExerciseId`, `draftSetCount`, `draftSource`
(`'prefill' | 'user'`) — and a single `SET_DRAFT` writes it together with both numbers. There is
deliberately no way to set weight without reps: a partial write would stamp the new exercise while
the other field still held the old one's value, which is the first bug one field at a time.

What gets painted is now **derived during render**, not written back by an effect. An effect runs
after paint at best and not at all until the summary lands, which is precisely how the stale value
showed through; it remains only to *record* the seed. Re-seeding over `source: 'user'` requires
either an exercise change or a set actually being **added** — `displaySets.length > draftSetCount`,
strictly greater. `!==` was the obvious form and is wrong: the count is transiently 0 while
`sessionSets` reloads after a remount, so `!==` reads a return-from-the-picker as "a set was logged"
and destroys the typed value. That was caught by walking the remount path during design, and now has
its own test.

**Reps gains a blank state**, matching weight. During the window before an exercise's history loads,
both fields show the em dash rather than a number belonging to something else; `repsValue` (`?? 8`)
is what actually gets logged, mirroring `weightValue` (`?? 0`). Considered and rejected: keeping reps
on its 8 default through that window — 8 is less obviously wrong than another exercise's rep count,
which is exactly what makes it worse to show.

Also rejected: sourcing the prefill from the warmed `history` cache to close the blank window
entirely. It would usually put the right number on screen instantly, but it widens the
`summaryQuery.isPaused || isError → derivedSummary` divergence on the resilience register beyond what
that entry was reasoned about, for a cosmetic gain. An honest blank is the smaller claim.

## Update — 2026-08-15: exercises can be measured in time, and the library says which (V46–V50)

The library shipped `Plank (sec)` and `Side Plank (sec)` because a set could only be weight × reps,
so seconds were typed into the Reps field and the unit lived in the *name*. Nothing downstream knew,
so a 60-second plank was ranked, exported and charted as "60 reps at 0 lb".

**An exercise is now measured either in reps or in time, and the screen tells you which.** That is
the whole idea; the log screen keeps its two steppers, its one primary button and its set list, and
only the second stepper's meaning changes.

**One entry per movement, with its natural measure.** Plank, Wall Sit, Dead Hang and Jump Rope are
time; Burpee, Mountain Climber and Air Squat are reps. Considered and rejected: shipping `Burpee`
*and* `Burpee (Time)` for the ~9 movements that genuinely go both ways. Two picker rows whose
difference the app cannot explain is friction at exactly the wrong moment — mid-workout, choosing.
Those are served by "+ Add your own exercise" instead, which gained a Reps/Time toggle. Two rules
decided every seeded row: things you **count** are reps, things you **sustain** are time; and a hold
is a different *movement*, not a mode (`Glute Bridge` / `Glute Bridge Hold` is a legitimate pair,
`Plank` / `Plank (Time)` is not).

**A weight vest needed no new field.** `weight` already means added load with `0` = bodyweight, the
convention `comparableLb` / `bodyweightOnly` / `prSort.isBodyweight` already run on.

**`reps = 0` on a hold, rather than a nullable column.** Also rejected: nullable `reps` with an XOR
constraint. It is more self-describing and it costs `int` → `Integer` across 69 call sites, NPE risk
at every `weight × reps`, seven DTOs and a rewrite of every existing plank row — to encode something
that is not even true. A hold genuinely has zero repetitions, so volume and `totalReps` stay correct
for free. The price is that `reps == 0` cannot be the "is this a hold" marker (it is also a legal
failed set); `tracking_type` is.

**Ranked on seconds alone, with load as a separate record.** A 60s bodyweight plank ties a 60s 45-lb
plank. Rejected: a load-adjusted hold score — it needs the person's bodyweight, which the app does
not store, and inventing one produces a number larger than anything they actually did, the same trap
`bestEst1rm` documents. "Heaviest load held" sits beside "Longest hold" the way `heaviestWeight` sits
beside `bestEst1rm`.

**The hold timer is part of the feature, not a follow-up.** Mid-plank you cannot type and cannot
watch a clock, so manual entry alone would have made the honest answer to "how long can you hold it?"
be *go get your watch*, in an app whose purpose is being usable during a workout. It reuses
`UIContext`'s per-person ticker rather than adding a second mechanism, and **Stop fills the field
without logging** — the primary button keeps meaning the same thing on every exercise.

**Both timers moved to wall-clock time** (`startedAt`/`endsAt`) in the same change. Counting interval
fires under-reports on the device this app is built for: iOS suspends timer callbacks when the screen
locks, which mid-hold is the normal case. The ticker also samples faster than it displays (200ms for
a 1s readout) because a 1s cadence is set at provider mount and left `0:00` on screen for up to two
seconds after the tap — long enough to read as "it didn't start".

**What was deliberately not reserved for: distance and pace.** V6 reserved `tracking_type = 'cardio'`
for exactly that, stating it existed so the addition "won't require a schema rework later". It went
unused for 45 migrations and was the wrong shape when the time came — V46 rewrote the constraint and
V47 added a column regardless. The reservation saved nothing. What matters is that the extension path
stays additive, and it does.

## Update — 2026-08-16: only the chrome that is doing work stays on screen

The design system pass made the Huddle lockup, the person bar and the tab bar travel together as
one sticky unit. It was fixing something real — before it, a single-person household scrolling a
sets list lost the tab bar off the top of the screen, because the person bar was the only one of
the three that ever stuck and it only stuck at two or more people. But it fixed that by making all
three stick for everyone, which spends **218px portrait / 178px landscape** permanently. An iPhone
held sideways mid-set has a ~390px viewport; that was ~46% of the screen given over to navigation
in the one posture where screen space is scarcest.

**Decision worth recording: stickiness is per-bar and depends on household size.** The tab bar
always sticks — it is navigation rather than context, and losing it was the original complaint. The
person bar sticks only at two or more people, where it is a switcher; with one person it is a
single always-active pill showing you your own name, which is a label, and labels can scroll away.
The Huddle lockup never sticks: it is branding, and the account menu it carries is not something
you reach for between sets. Both cases land near 145px.

**The person bar moves between two tree positions rather than toggling a CSS class**, which is the
part worth not undoing. It keeps the sticky region a contiguous *suffix* of the chrome in both
cases, so it stays one sticky box at `top: 0`. The alternative — a stack of sticky siblings — needs
each one's `top` to equal the summed height of the bars above it, and that number is not knowable
in CSS: it changes with orientation (the landscape rules re-pad all three bars), with the logo, and
with the safe-area insets. It would have meant a ResizeObserver feeding a custom property, to buy
nothing. The cost of the chosen approach is that crossing 1↔2 people remounts `PersonPillBar`,
which is free today because its only local state is `showAddPerson` and `AddPersonModal` closes
itself.

**What this cost, and the general lesson: moving an element out of a sticky box moves it out of a
stacking context.** The account dropdown hangs out of the header and down across the chrome. While
the header lived *inside* `.app-chrome` the menu was a child of that context and painted over its
siblings for free; outside it, the menu and the chrome are siblings both at `z-index: 10`, ties
resolve by DOM order, and the chrome — later in the DOM — won the hit test and silently swallowed
every click. Nothing was visually wrong; the menu rendered perfectly and simply could not be
clicked.

The header cannot just be given a higher z-index than the chrome, because it has to paint *below*
it while scrolling past. So the dropdown gets its own layer instead, and the two z-indexes that now
constrain each other are the only tokenised ones (`--z-app-chrome`, `--z-header-menu`) — the app's
other overlays (rest timer, toast, celebration, modal, SW updater) never overlap one another and
stay as local values. Tokenising all eight would imply an ordering that does not exist.

That regression was caught only as **seven unrelated specs** failing on `person-pill-bar …
intercepts pointer events`, which is a slow and confusing way to learn it. `sticky-chrome.spec.ts`
now asserts the menu is clickable over the chrome directly.
