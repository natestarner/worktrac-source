---
paths:
  - "backend/src/main/java/com/worktrac/backend/workoutset/**"
  - "backend/src/main/java/com/worktrac/backend/workoutsession/**"
  - "backend/src/main/java/com/worktrac/backend/sessionexercisenote/**"
  - "backend/src/main/java/com/worktrac/backend/exercise/**"
  - "backend/src/main/java/com/worktrac/backend/stats/**"
  - "backend/src/main/java/com/worktrac/backend/routine/**"
  - "frontend/src/components/routines/**"
---

# Workout data model invariants

Full narrative: `docs/architecture/data-model.md`.

## `workout_sets.rest_seconds` (V17)

How long a person rested before a given set. Rule lives in `WorkoutSetService`
(`logLiveSet`/`logSetIntoSession`/`computeRestSeconds`) and `WorkoutSet.java`. Preserve all of:

- **Null unless logged through the live-session endpoint** (`POST /api/people/{personId}/live-sets`
  → `logLiveSet`). Anything through `POST /api/sessions/{sessionId}/sets` (`logSetIntoSession`)
  always gets `null`. **Do not gate this on the session's `manual` flag instead** — `manual` only
  catches the retroactive "Log a past workout" flow and misses an originally-*live* session being
  resumed via History's "Edit" to append a forgotten set days later, which is equally untrustworthy.
  Gating on *which endpoint handled the write* catches both, because `logSetIntoSession` is only
  ever called when the frontend is in explicit "editing a specific existing session" mode
  (see `frontend/src/components/log/ExerciseDetail.jsx`'s `handleLogSet`).
- Null for the first set of an exercise in a session.
- Otherwise computed once at insert time as the gap to the most recent prior set's `created_at`
  for the **same session + same exercise** — scoped by exercise so supersetting doesn't corrupt it.
- "Effective logged time" is the client's `clientLoggedAt` when supplied, else the server `Clock`.
- **Immutable after insert** — `WorkoutSet.restSeconds` has no setter. `editSet` must never touch
  it; deleting/editing a neighbour never recomputes it.
- Computed from the injected `Clock`, never `Instant.now()` (see `RestSecondsTest`).
- **CSV import is a third writer, and it is not an exception to the rule above — it is outside it.**
  `CsvImportService` sets `restSeconds` straight from the file's `Rest (sec)` column via the
  `WorkoutSet` constructor. It neither computes nor recomputes anything: it *restores* a recorded
  fact, exactly as it restores `created_at`. The rule forbids a non-live path *deriving* the value,
  which would be a fabrication; replaying one the app itself wrote is the opposite.
  `unit` is imported the same way — from the row, not `account.defaultUnit` — so a `kg` set stays
  `kg` on an `lb` account. Full reasoning: `docs/architecture/import-export.md`.

## Duration-tracked exercises (`exercises.tracking_type`, `workout_sets.duration_seconds`, V46-V50)

An exercise measures either reps or seconds held. `tracking_type` is `'strength' | 'duration'`;
V46 replaced the never-used `'cardio'` reservation with it.

- **`reps` is `0` on a hold, never null.** A hold genuinely has zero repetitions, and keeping the
  column `NOT NULL` means volume (`weight * reps`), `totalReps` and every weight-based aggregate
  stay correct with no null handling. `CK_workout_sets_duration_reps` enforces the pairing.
- **What marks a row as a hold is its exercise's `tracking_type`, NEVER `reps == 0`** — 0 is also a
  legal strength value (a failed set). Client-side the marker is `durationSeconds != null`.
- **`weight` is unchanged**: added load, `0` = bodyweight. A weight vest needs no new field, and
  `comparableLb`/`bodyweightOnly`/`prSort.isBodyweight` keep their existing meaning.
- **`Exercise.trackingType` has no setter, deliberately.** Flipping it would reinterpret every set
  already logged against that exercise. It is set at construction and `ExerciseService.update`
  (rename) ignores the field.
- **Ranking a hold uses seconds ALONE** (`StatsService#comparableValue`, mirrored in
  `utils/formulas.js#comparableValue`). Added load deliberately does not enter it — a load-adjusted
  hold needs the person's bodyweight, which the app doesn't store. "Heaviest load held" is a
  separate record instead, the same shape as `heaviestWeight` beside `bestEst1rm`.

### ⚠️ `resolveMeasure` must reject as little as possible

`shouldRetryWrite` treats any 4xx outside `{408, 429}` as **terminal**, so every rejection in
`WorkoutSetService#resolveMeasure` permanently discards a set that may have sat in the durable
outbox through an entire outage. Only genuinely impossible payloads are refused.

**This reasoning does not transfer to CSV import**, and `CsvImportParser` is deliberately stricter.
The rule exists because a 400 permanently discards a durably-queued write; a synchronous import
rejecting a row costs nothing, because the person still has the file and the preview names the line
it could not read. A per-row error report is strictly better there than lenient coercion. Don't
"align" the two.

One recoverable shape is **accepted**: a duration exercise receiving `reps > 0` with no
`durationSeconds` stores the reps as the duration. That is what a client sends when its cached
exercise catalog predates V50's conversion of `Plank (sec)` / `Side Plank (sec)` (an offline client
holds that cache for its whole outage), and those numbers already *were* seconds. Widening the
rejections here is a data-loss bug, not a strictness improvement.

## Log-set idempotency (`workout_sets.client_key`, V40/V41)

- `findDuplicate` returns the already-committed set (with `isPR = false`) instead of inserting a
  second row. Blank/absent key ⇒ no dedup. A unique filtered index backstops the concurrent case.
- **Correcting a set's weight/reps must never be a re-dispatch of its create under the same
  `idempotencyKey`** — `findDuplicate` returns the committed row *ignoring the new payload*, so a
  same-key edit-via-recreate is silently discarded. An edit is always a separate `EDIT_SET` write.
  See `docs/incidents/2026-07-30-editing-queued-offline-set.md`.

## Creating an exercise that already exists returns it -- never a 409

`ExerciseService.add` resolves in a fixed order: **`clientKey` -> validate `trackingType` ->
`(visible to account, name, trackingType)` -> insert.** A match on the third step returns the
existing row. The client applies the identical rule before it dispatches
(`utils/exerciseDuplicates.js`); the server is the backstop for what a cache cannot see -- two
devices creating offline, or a create sent against a stale catalog snapshot.

- **Do not express this as a 409, and do not add a unique index on the name.** A definitive 4xx is
  the only thing that ends a durable write's retries (`shouldRetryWrite`), so a rejected create is
  discarded permanently -- together with every set already queued behind it against a temp exercise
  id that would then never resolve. A 200 carrying the existing row is what lets that temp id map
  onto something real.
- **The name lookup returns a `List`, not an `Optional`.** Nothing prevented duplicate names before
  this, so accounts already hold rows that match; a single-result query would throw
  `NonUniqueResultException` on exactly the data this exists to stop growing. Ordering (own account
  before global, then lowest id) is in the query, and mirrors the client's `preferredMatch`.
- **Matching is case-insensitive on both sides.** SQL Server's default collation is, so the client
  lowercases to agree; a case-sensitive client check would let "bench press" through and then
  silently resolve to the existing row on sync.
- **A global (preloaded) exercise counts as a duplicate**, so sets land on the canonical row rather
  than a private fork. The scoping mirrors `findVisibleToAccount`; it must never match across
  accounts.
- **Known gap, accepted:** the server does not apply the client's `(Time)`/`(Reps)` suffix, so two
  devices creating the same name offline with *different* measures still converge to two rows
  sharing a name. It needs a genuine cross-device offline race, it is no worse than the old
  behaviour, and the alternative -- the server renaming what the client asked for -- is worse.

Same-name-different-measure is a *different exercise*, and only the name is disambiguated. Never
rename the existing one to match: it already has sets and PRs against it, and rename is an
online-only write. `V50__convert_seconds_exercises_to_duration.sql` made the same call.

## The import stamp (`import_batch_id`, V53-V55)

`workout_sets`, `workout_sessions` and `session_exercise_notes` each carry a nullable
`import_batch_id`. Null means "logged in the app", which is the honest answer rather than
"unknown". Preserve all of:

- **Only a session the import CREATED is stamped**, never one it appended rows to. Undo deletes
  stamped-and-now-empty sessions, so stamping an appended-to session would delete a workout that
  was already there.
- **Every undo query is scoped by person AND batch.** "Rows with this stamp belong to this person"
  is an app-layer invariant nothing in the schema enforces, and these are deletes. `ImportUndoTest`
  forges the invariant on purpose and requires the delete to refuse anyway.
- **The foreign keys are `NO ACTION` and must stay so.** `workout_sets` already reaches `people` by
  two routes (directly, and via `workout_sessions ON DELETE CASCADE`); a third cascading path is
  the multiple-cascade-path configuration SQL Server rejects outright.
- **That makes the deletion order circular** — sets before batches, batches before people, but
  deleting people is what deletes the sets. `ImportBatchCleanup` resolves it by clearing the stamps
  first and deleting batches second. `AccountDeletionService` **and** `TestDataCleanupService` both
  go through it; the latter runs after every local e2e run, so missing it breaks the whole suite's
  teardown rather than anything that looks like import.

## Exercise notes — two independent features, don't conflate

- **Persistent note** (`person_exercise.note`, V35) — standing per-person reminder, every session.
- **Session note** (`session_exercise_notes`, V36) — scoped to one workout, keyed
  `(session_id, exercise_id)`. Two write paths mirror the live/session split above.
- **Both: a blank/whitespace-only save deletes the row** rather than storing an empty string, so
  "has a note" is testable by row presence alone. Don't special-case empty strings downstream.

## Two tag writers, and they must keep disagreeing

`PersonExerciseService.setTags` **replaces** a person's whole tag set for an exercise — correct for
the tag editor, where the list on screen is the intended end state.
`applyImportedPersonalization` **unions** instead, and likewise writes a note only where there is
none and never clears a favorite.

An import must never remove personalization it didn't put there: the file may be months old, and
the only thing it can honestly claim is what it *contains*, never the absence of anything. Two
writers with different semantics on one relation is exactly what gets "simplified" into one — this
one is deliberate.

## Picker membership — `PersonExerciseService.listForPerson`

**Every** personalization type `PersonExercise` can hold must put the exercise in the person's
picker: favorite, note, tags, custom fields. This has now broken twice (notes, then tags +
custom fields). **Any new per-person personalization field needs the same treatment** — ask "if
someone does only this, with nothing else, will they ever see it again?" Without it the frontend
falls back to the account-wide catalog DTO, which carries none of these fields, and the change is
invisible forever. See `docs/incidents/2026-08-05-exercise-personalization-picker-gap.md`.

## `routines.sort_order` (V61/V62) — the person's own arrangement

Routines are listed by `sort_order`, not `created_at`. The old ordering was **oldest first**, which
put the routine someone built first (and most likely abandoned) at the top of both the Routines tab
and the Log picker's quick-start block, and their current program at the bottom.

- **The finder is `findByPerson_IdOrderBySortOrderAscIdAsc`.** The `id` tiebreak is defensive, and
  it is also a **test hazard**: while a list is still in creation order, `id` ascends in the same
  direction as `sort_order`, so an assertion over a freshly-created list passes just as happily
  against a column stuck at 0. The only case that discriminates is **creating after a reorder** —
  that is what `RoutineControllerTest`'s ordering tests do, and the first drafts of them were
  vacuous without it.
- **Every insert path assigns a position.** `create` appends at `max + 1`; `copy` appends at the
  **target** person's `max + 1`, not the source's — easy to miss, because `copy` builds the
  `Routine` directly rather than going through `create`.
- **Reorder takes the person's WHOLE list, and refuses anything else.** `PUT
  /api/people/{personId}/routines/order` requires the id set to match that person's routines
  exactly; a partial or duplicated list is a 400 (`IllegalArgumentException`). A partial list has no
  correct interpretation — the omitted routines would keep positions that now collide — and
  silently renumbering around it is worse than refusing. Terminal 4xx is right here because this is
  an online-gated write with no outbox behind it.
- **It is its own endpoint, not an overload of `update`.** `RoutineRequest` carries `name` +
  `exerciseIds`, so reordering through it would rewrite every routine's exercise membership to move
  one row.
- **`RoutineDto` deliberately does not expose `sortOrder`.** Order is implied by array position;
  widening the DTO would put a new field into every persisted query cache for no gain (the axis-D
  case in `resilience.md`).
- **V62 backfills from `created_at`**, so every existing household saw exactly the order it saw
  before the feature shipped, and nothing moved until someone chose to move it. A migration that
  reordered people's routines as a side effect of shipping reordering would be the worst possible
  introduction to it.

### The reorder UI is a MODE, and the gate is on the way in

`RoutinesTab` swaps the row actions for grip handles behind a `Reorder routines` toggle, holds the
working order as a **local draft**, and commits **one** PUT on `Done` — the same
local-rows-then-save shape `RoutineFormModal` uses for the exercises inside a routine.

- **A mode, not always-visible handles.** A row already carries Copy to… / Edit / Delete / Start
  routine, and a fifth control is too many on a phone; a mode also gives exactly **one** control to
  `OfflineDisabledWrap` instead of a handle per row.
- **Routine CRUD is Tier-3, so the gate is on opening the mode**, not on `Done`. Refusing at
  `Done`, after someone has arranged a dozen routines, would throw the arrangement away.
- **A failed commit keeps the mode open with the draft intact.** `useGatedMutation` has already
  shown the toast; `run` resolves `undefined` for both an offline refusal and a failed write, which
  is exactly the signal needed. Same call `ImportDataModal` makes by staying open on failure.
- **An unchanged order writes nothing.** Opening the mode and closing it again is not a write, and
  skipping it also stops the gate refusing a no-op offline, which would read as "reordering is
  broken".
- **Switching people abandons the draft.** `RoutinesTab` is not remounted on a person switch, so
  without the reset one person's half-finished arrangement would show on another's list — and
  `Done` would commit it against the wrong `personId`.
- **Reuse `RoutineFormModal`'s dnd-kit setup verbatim**: listeners on the grip handle via
  `setActivatorNodeRef` (never the row — this is a full scrolling tab, so a row-wide activator
  fights every scroll gesture), `POINTER_SENSOR_OPTIONS` hoisted to module scope (`useSensor`
  memoizes on object identity), and hand-rolled arrow keys rather than dnd-kit's `KeyboardSensor`
  (which derives the next slot from measured rects jsdom never lays out).
