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

## Log-set idempotency (`workout_sets.client_key`, V40/V41)

- `findDuplicate` returns the already-committed set (with `isPR = false`) instead of inserting a
  second row. Blank/absent key ⇒ no dedup. A unique filtered index backstops the concurrent case.
- **Correcting a set's weight/reps must never be a re-dispatch of its create under the same
  `idempotencyKey`** — `findDuplicate` returns the committed row *ignoring the new payload*, so a
  same-key edit-via-recreate is silently discarded. An edit is always a separate `EDIT_SET` write.
  See `docs/incidents/2026-07-30-editing-queued-offline-set.md`.

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
