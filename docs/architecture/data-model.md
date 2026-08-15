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

## Endurance (time-based) exercises

Added V46–V50. The problem: the app could only record a set as **weight × reps**, so time-based
work was faked by encoding the unit in the exercise *name* — the seeded library literally shipped
`Plank (sec)` and `Side Plank (sec)`, where the person typed seconds into the `reps` field.
Nothing downstream knew those numbers were seconds, so a 60-second plank was stored, ranked,
exported and charted as "60 reps at 0 lb".

### The product shape

**An exercise is measured either in reps or in time, and the screen tells you which.** That is the
entire idea a person has to learn. The log screen keeps its two steppers, its one primary button
and its set list; only the second stepper's meaning changes.

The library therefore carries **one entry per movement with its natural measure** — Plank, Wall
Sit, Dead Hang and Jump Rope are time; Burpee, Mountain Climber and Air Squat are reps. There are
no `(Time)` suffixes and no duplicate rows: two entries whose difference the picker cannot explain
is friction at exactly the wrong moment. Movements that genuinely go both ways are served by
"+ Add your own exercise" (one tap from the picker's search box), which grew a Reps/Time toggle.

Two rules decided every seeded row: **things you count are reps; things you sustain are time**, and
**a hold is a different movement, not a mode** (`Glute Bridge` / `Glute Bridge Hold` is a
legitimate pair; `Plank` / `Plank (Time)` would not be).

### Why `reps = 0` rather than a nullable column

The first design made `reps` nullable with an XOR constraint. That is more self-describing and it
was not worth it: `int` → `Integer` across 31 backend and 38 frontend call sites, NPE risk at every
`weight × reps`, seven DTOs changed, and a migration to rewrite every existing plank row.

V50 retires the hack itself: `Plank (sec)` and `Side Plank (sec)` become `Plank` and `Side Plank`,
typed as duration, with each logged set's `reps` moved into `duration_seconds`. Nothing is
reinterpreted — those numbers were always seconds. Leaving them would have put two Planks in the
picker with no visible explanation of the difference, which is the exact friction the
one-entry-per-movement library exists to avoid.

`reps = 0` on a hold is **not a sentinel standing in for "unknown"** — a hold genuinely has zero
repetitions. That makes every weight-based aggregate fall out correctly for free: volume is
`weight × 0 = 0`, `totalReps` adds 0, and the row still counts as a set. It also made the legacy
conversion trivial, since `Plank (sec)`'s stored numbers already *were* the seconds.

The cost is that `reps == 0` cannot be the "this is a hold" marker — it is also a legal strength
value (a failed set). The marker is the exercise's `tracking_type` server-side and
`durationSeconds != null` client-side, and that distinction is load-bearing.

### The hold timer

Manual entry alone would have been the wrong shape: mid-plank you cannot type, and you cannot watch
a clock while looking at the floor, so the honest answer to "how long can you hold it?" would have
been "go get your watch" — in an app whose stated purpose is being usable *during* a workout. Two
ways to fill the field, matching how people actually plank: hold to the prefilled target and tap
**Log set** (one tap, identical to logging a bench set), or **Start timer** → **Stop** → **Log
set**. Stopping deliberately does not log.

It reuses `UIContext`'s existing per-person ticker rather than adding a second mechanism, and both
timers were converted to **wall-clock** (`endsAt` / `startedAt`) at the same time — see
`.claude/rules/log-screen.md` for why counting interval fires is wrong on a device whose screen
locks.

### The deliberate limitation

A hold is ranked on **seconds alone**; added load does not enter the comparison, so a 60s bodyweight
plank ties a 60s 45-lb plank. A load-adjusted hold would need the person's bodyweight, which the app
does not store, and inventing a formula produces a number larger than anything they actually did —
the same trap `.claude/rules/trends.md` documents for est. 1RM. **"Heaviest load held" is a second
record instead**, exactly as `heaviestWeight` sits beside `bestEst1rm` rather than being fused into
it. Bodyweight tracking, if it is ever added, is what would retire this.

### What was deliberately not reserved for

Distance and pace (running, rowing, calories) is the one remaining modality, and it is **not**
reserved for here. This codebase already ran that experiment: V6 shipped `tracking_type` with
`CHECK IN ('strength','cardio')`, its comment stating the reservation existed so the addition
"won't require a schema rework later". It sat unused for **45 migrations**, and when the feature
became real `'cardio'` turned out to be the wrong shape — V46 rewrote the constraint and V47 added
a column regardless. The reservation saved nothing it was meant to save.

What matters instead is that the extension path stays additive, and it does: distance later is one
CHECK-widening migration plus nullable columns plus a third arm on the same `isDuration` branch.

RPE, tempo and per-side disambiguation are out of scope for a different reason — they are
*annotations on a set*, not measures, so they never interact with `tracking_type` at all.

### Two adjacent gaps found while building this (each its own change)

- **Assisted lifts are ranked backwards.** `Assisted Pull-up Machine` and `Assisted Dip Machine`
  are in the library, but `comparableLb` treats weight as more-is-stronger — so logging *more*
  assistance registers as a bigger lift.
- **Bodyweight tracking** would retire the hold-ranking limitation above and make bodyweight-lift
  progression honest generally.

