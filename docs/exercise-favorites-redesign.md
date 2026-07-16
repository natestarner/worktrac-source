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
  one-tap starters.
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

The PR board and Trends stopped surfacing the legacy per-exercise category and were made
null-safe (user-created exercises have no base category).

## Status

- Branch `feat/exercise-favorites-overlay`.
- Backend `mvn verify` green, including `ExerciseFavoritesTest` (favorite isolation across
  people/accounts, logged-shows-in-picker, custom-field isolation, category filing,
  recommendations, routine auto-favorite, global edit/delete rejected, PRs safe for
  uncategorized exercises) and all pre-existing suites.
- Frontend build, lint, and tests green.
