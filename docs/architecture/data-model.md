# Data Model Notes

- The app must keep each person's workout data (exercises, sets, reps, history) fully
  separate — every workout-related table should scope rows to a specific person, and
  every query must filter by the active person.
- **`workout_sets.rest_seconds`** (added in `V17__add_rest_seconds_to_workout_sets.sql`)
  records how long a person rested before a given set, for the Trends "rest between
  sets" feature. The full rule lives in `WorkoutSetService.java`
  (`logLiveSet`/`logSetIntoSession`/`computeRestSeconds`) and `WorkoutSet.java`, but the
  invariants any future change must preserve are:
  - **Null unless the set was logged through the live-session endpoint**
    (`POST /api/people/{personId}/live-sets` → `WorkoutSetService.logLiveSet`). Anything
    logged through `POST /api/sessions/{sessionId}/sets` (`logSetIntoSession`) always gets
    `null` — **do not** gate this on the session's `manual` flag instead. `manual` only
    catches sessions created via the retroactive "Log a past workout" flow; it misses an
    old, originally-*live* (`manual = false`) session being resumed via History's "Edit"
    button to append a forgotten set days later, which is exactly as untrustworthy for
    rest-time purposes. Gating on which endpoint handled the write catches both cases,
    because `logSetIntoSession` is *only* ever called when the frontend is in that
    explicit "editing a specific existing session" mode (see
    `frontend/src/components/log/ExerciseDetail.jsx`'s `handleLogSet`), never for
    real-time logging.
  - Null for the first set of an exercise in a session (nothing to diff against).
  - Otherwise, computed once at insert time as the gap between this set's effective logged
    time and the most recent prior set's `created_at` for the *same session + same exercise*
    — scoped by exercise, not just session, so supersetting into a different exercise between
    sets doesn't corrupt the number.
  - **"Effective logged time" is the client's `clientLoggedAt` when the request supplies it,
    otherwise the server `Clock`.** A live-set write now carries the moment it actually
    happened, and `created_at` honors it — so a set logged now but synced later (retry after a
    dropped response, or a future offline replay) keeps an honest `created_at` and therefore an
    honest rest gap, instead of measuring the sync moment. When `clientLoggedAt` is absent
    (older/other callers) it falls back to the `Clock`, so the invariant below and
    `RestSecondsTest` are unaffected.
  - **Immutable after insert**, by construction: `WorkoutSet.restSeconds` has no setter.
    Editing a set's weight/reps (`editSet`) must never touch it, and deleting or editing
    a neighboring set does not retroactively recompute it — it's a snapshot of what
    actually happened at the time, not a live-derived value.
  - Computed from the app's injected `Clock` bean (`ClockConfig`), not `Instant.now()`,
    so it's deterministically testable with `MutableClock` (see `RestSecondsTest.java`),
    matching the same pattern `WorkoutSessionService` uses for its 8-hour staleness rule.
- **Log-set idempotency (`workout_sets.client_key`, added in `V40`/`V41`).** The log-set
  request carries an optional client-generated `idempotencyKey`; `WorkoutSetService.findDuplicate`
  returns the already-committed set (with `isPR = false`) instead of inserting a second row, so a
  retried or offline-replayed write can't double-log. A unique filtered index backstops the
  concurrent case. Blank/absent key ⇒ no dedup. This is what makes the frontend's optimistic
  log-set + retry safe. **Correcting a set's weight/reps must never be expressed as a re-dispatch
  of its create under the same `idempotencyKey`** — `findDuplicate` returns the already-committed
  row regardless of the new payload, so a same-key edit-via-recreate is silently discarded if the
  original create already landed. See the "editing a still-queued offline set" Resolved Incident
  below: an edit is always a genuinely separate `EDIT_SET` write, never a mutation of the create.
- **Rest-timer display preference (`people.rest_timer_enabled`, added in `V39`).** A per-person
  setting, but persisted account-side (not per-device localStorage) and surfaced on each person in
  `/api/auth/me`, so Settings shows every person's toggle at once and it syncs across devices. Set
  via `PUT /api/people/{personId}/rest-timer-preference`. Display-only: `rest_seconds` is recorded
  regardless. A one-time client migration (`lib/restTimerMigration.js`) carries any legacy
  localStorage value up on first load.
- **Exercise notes** are two independent, coexisting features — don't conflate them:
  - **Persistent note** (`person_exercise.note`, added in
    `V35__add_note_to_person_exercise.sql`) — a standing per-person reminder shown every
    session for that exercise (e.g. "keep elbows tucked"). Set via
    `PersonExerciseService.setNote` / `PUT /api/people/{personId}/exercises/{exerciseId}/note`.
    Isolated per person the same way `is_favorite` already is. A note (like favoriting, tagging,
    and adding a custom setup field) also puts the exercise in the person's Log picker
    (`PersonExerciseService.listForPerson` — picker = favorited UNION noted UNION tagged UNION
    has-a-custom-field UNION logged; see the 2026-08-05 Resolved Incident below for why *all
    four* of these have to be in that union, not just favorite/note/logged) even if it was
    never favorited or logged: without this, the frontend's `personExercises.find()` would miss
    it and fall back to the personalization-less catalog DTO, making the just-saved
    personalization invisible on screen.
  - **Session note** (`session_exercise_notes` table, added in
    `V36__create_session_exercise_notes.sql`) — scoped to one workout, keyed on
    `(session_id, exercise_id)`. Managed by `SessionExerciseNoteService`
    (`com.worktrac.backend.sessionexercisenote`). Two write paths mirror the
    `logLiveSet`/`logSetIntoSession` split above: `PUT
    /api/people/{personId}/live-exercise-notes` calls
    `WorkoutSessionService.getOrCreateLiveSession` first, so a note can be saved *before
    any set is logged* in a workout; `PUT
    /api/sessions/{sessionId}/exercises/{exerciseId}/note` targets an explicit (typically
    past) session directly. The previous session's note is surfaced back via
    `StatsService.getLastSession`'s `LastSessionDto.note` (the "Last time" card) and via
    `WorkoutSessionService`'s History DTOs (`HistoryEntryDto.note`).
  - **Both types: a blank/whitespace-only save deletes the underlying row** rather than
    storing an empty string, so "has a note" can be tested by row presence alone — don't
    special-case empty strings anywhere downstream.

