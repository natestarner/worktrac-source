---
paths:
  - "backend/src/main/java/com/worktrac/backend/workoutset/**"
  - "backend/src/main/java/com/worktrac/backend/workoutsession/**"
  - "backend/src/main/java/com/worktrac/backend/sessionexercisenote/**"
  - "backend/src/main/java/com/worktrac/backend/exercise/**"
  - "backend/src/main/java/com/worktrac/backend/stats/**"
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

## Exercise notes — two independent features, don't conflate

- **Persistent note** (`person_exercise.note`, V35) — standing per-person reminder, every session.
- **Session note** (`session_exercise_notes`, V36) — scoped to one workout, keyed
  `(session_id, exercise_id)`. Two write paths mirror the live/session split above.
- **Both: a blank/whitespace-only save deletes the row** rather than storing an empty string, so
  "has a note" is testable by row presence alone. Don't special-case empty strings downstream.

## Picker membership — `PersonExerciseService.listForPerson`

**Every** personalization type `PersonExercise` can hold must put the exercise in the person's
picker: favorite, note, tags, custom fields. This has now broken twice (notes, then tags +
custom fields). **Any new per-person personalization field needs the same treatment** — ask "if
someone does only this, with nothing else, will they ever see it again?" Without it the frontend
falls back to the account-wide catalog DTO, which carries none of these fields, and the change is
invisible forever. See `docs/incidents/2026-08-05-exercise-personalization-picker-gap.md`.
