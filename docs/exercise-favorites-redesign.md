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
