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

## Muscles worked (V90–V93)

What an exercise trains, so the app can show it (a body diagram and a line of muscle names on the
Log screen) and, later, count it (a muscle heat map on Trends). Planned 2026-11-06 together with
in-app how-to videos, which share the same entry point and the same library-curation problem.

- **`muscles`** is reference data: a fixed list of codes (`chest`, `rear_delts`, `cardio`, …) with
  a display name, a sort order and two flags — `drawn` (has a shape on the body diagram) and
  `counted` (counts toward muscle statistics). Sixteen are drawn, matching the regions the body art
  can shade; adductors, abductors, hip flexors and neck are listed but not drawn; `full_body` and
  `cardio` are labels for conditioning work, neither drawn nor counted.
- **`exercise_muscles`** holds `(exercise_id, muscle_code, role)` with role `primary` or
  `secondary`, one row per pair. Library and household exercises use the same table.
- **One list, three copies, one test each.** `shared/muscles/muscles.json` is the agreed list; the
  database must equal it (`LibraryExerciseMusclesTest`) and so must the client's
  `utils/muscles.js` (`muscles.test.js`). The server only ever sends codes; names come from the
  client, which drops a code it does not know (an App Store build lives for months).
- **Every library exercise has a primary muscle**, enforced by `LibraryExerciseMusclesTest`. V93
  matches by name, so a typo would otherwise insert nothing and fail silently. A library exercise
  added later is described in the same change.
- **On the catalog row only** (`ExerciseDto.primaryMuscles` / `secondaryMuscles`, in sort order),
  not on `PersonExerciseDto`: muscles are a fact about the movement, not personalization, so the
  client looks an exercise up in the catalog by id. Resolved in one query per list call
  (`ExerciseMuscleResolver`), keyed on the account like the catalog itself.
- **Absent means empty.** A catalog cached before these fields existed, and an exercise created
  offline (a temp row), have neither field; `exerciseMuscles()` returns empty lists for both.
- Not a return of the categories V33 dropped — see `trends.md`, "Deliberately not built".

### A household's own exercises

- **Picked when the exercise is created** — optional `primaryMuscles` / `secondaryMuscles` on
  `POST /api/exercises`. That is a durable offline write, so `ExerciseMuscleWriter` refuses nothing:
  unknown codes are dropped, a code listed both ways stays primary, absent means none. Written only
  on the branch that genuinely inserts; a replay or a duplicate name leaves the existing row's
  muscles alone (`CustomExerciseMusclesTest`).
- **The temp row carries them** (`AddEditExerciseModal`), so the strip shows them before the create
  syncs, and the queued `CREATE_EXERCISE` variables carry them so the server stores them on replay.
  Both are sent only when something is picked, so a create without muscles is the request it always
  was. `parity-custom-exercise-muscles.spec.ts` checks the screen in every mode and the server
  afterwards (verified red by dropping them from the queued create).
- **The picker prefills a suggestion** (`utils/muscles.js#suggestMuscles`): the library exercise
  sharing the most movement words with the typed name, ignoring equipment words ("Cable Fly" is a
  fly). A guess the person can change, never saved on its own.
- **The picker is grouped by body area** (`components/exercise/MusclePicker.jsx`, 2026-11-08). The
  22 muscles as one flat wall of chips read as noise, and most exercises use 2-4 of them. Five
  rows (`utils/muscles.js#MUSCLE_GROUPS`, client-only: the server has no groups) start closed and
  each names what is picked in it, so a suggestion or a saved set reads without opening anything.
  A tap still cycles main -> helping -> cleared. `muscles.test.js` fails if a muscle is in no group
  or two, since an ungrouped muscle could never be picked. The chips wear the body diagram's
  colour: main is solid `--color-muscle`, helping is that colour at `--muscle-helping-opacity`, the
  same token the About sheet's key reads, so a muscle tapped here looks the same in the About sheet
  afterwards (it was the one place muscles still showed in the orange accent).
- **Changed later through `PUT /api/exercises/{id}/muscles`**, an online-only write from Customize.
  Same "who may" as rename (the creator or the owner; `EDIT_OWN_SHARED_RESOURCE` + the service
  check, pinned in `MemberPermissionsTest` and verified red), but without rename's "nobody else is
  using it" 409: muscles describe the movement and relabel nobody's history. Library exercises 403.
- **Not in the CSV.** Export carries no muscles column, so importing a file into a fresh household
  brings custom exercises back without muscles (library exercises get theirs from the name).
  Adding a `Muscles` column is possible later; the round trip stays byte-identical meanwhile
  because neither side writes one.

## How-to videos (V94)

A library exercise can carry one how-to video (`exercise_videos`): a pointer to a public YouTube
video, played inside the app. Built 2026-11-06; the first 57 videos (Muscle & Strength's own
YouTube clips) arrived the same day in `V97`, from `docs/exercise-videos/library-videos-2026-11-06.csv`.
That README records how they were found and checked, and why the other 106 have none (most of
Muscle & Strength's newer clips are on Vimeo, locked to their own site). Nothing about the design
depends on which channel a video comes from.

- **Rows arrive by migration**, like the library itself. `scripts/video-migration.mjs` turns a
  reviewed CSV (`exercise,video_id,start_seconds,source_label`) into a migration that matches
  library exercises by exact name and **throws if any name matched nothing**. V93's name matching
  failed silently on a typo; this one fails every backend test instead. Proven against a local
  database with a deliberately misspelt row (2026-11-06).
- **An id, never a URL.** `ExerciseVideoDto` is `{ provider, videoId, startSeconds, sourceLabel }`,
  the table checks `LEN(video_id) = 11`, and the client builds the only two URLs it ever uses: its
  own `/embed/youtube.html` page and a plain YouTube watch link. The embed page validates the id
  again, so nothing in a row can point the player anywhere but YouTube.
- **Library only.** Custom exercises get muscles, not videos (decided 2026-11-06). Every read joins
  the exercise and requires `account_id IS NULL`.
- **Only `active` rows are sent.** `ExerciseVideoChecker` asks YouTube's oEmbed endpoint about each
  video once a day (04:30 UTC, ShedLock'd to one replica): 200 means embeddable, 400 means no such
  video (measured: a well-formed id that does not exist answers 400, not 404), and 401/403/404
  mean private, embedding turned off, or removed (YouTube's documented behaviour, not reproduced
  here). Anything else, including no answer, changes nothing, so a YouTube outage cannot hide every
  video. A video that comes back is shown again. Rows are never deleted.
- **On the device:** the catalog is cached like the names, so the play button and the sheet are the
  same offline. The player itself needs YouTube, so offline it is replaced by a sentence (the one
  connectivity branch, on `resilience.md`'s register). Nothing loads until the play button is tapped,
  and the video starts muted. In the App Store app the embed page comes from the web host, because
  YouTube refuses to play inside `capacitor://localhost` (`native-apps.md`).
- **Ads:** monetised channels can show YouTube's ads inside an embed, and we cannot turn them off.
  Accepted for now (2026-11-06); our own videos are the long-term answer.

## The 2026-11-06 library expansion (V98-V101)

Fifty exercises joined the library (163 to 213), approved by Nate from a hand-curated shortlist.

- **Where they came from.** The free-exercise-db dataset (Unlicense; names and muscle facts only)
  had 526 strength exercises with gym equipment that the library lacked. These were matched by name
  against Muscle & Strength's exercise directory, and kept only where the movement matched closely.
  Duplicates of exercises we already had under another name were dropped ("Dumbbell Flyes" is our
  Dumbbell Chest Fly), along with false matches and obscure variants. 50 remained.
- **Huddle's naming.** Equipment first, as V34 set out, and "Single-Arm" rather than "One-Arm".
  The other names lifters type ("Crush Press", "SLDL", "Tricep Kickback") are aliases (V100).
- **Each arrives complete.** Muscles (V99) are described the way V93 described the exercise's
  closest relative. Videos (V101) cover the 22 whose Muscle & Strength clip is on YouTube; the other
  28 are on site-locked Vimeo and have none (`docs/exercise-videos/README.md`).
  `LibraryExerciseMusclesTest` (213) and `LibraryExerciseAliasesTest` (69) pin the counts, and
  V99-V101 each throw on a name that matches nothing.
- **A household that already made one of these keeps its own.** Their row holds their History.
  The picker's search shows their row instead of both (`utils/exerciseSearch.js`), the same "own
  account first" preference that creating an exercise applies. Nothing on the server changes, and
  the library row stays reachable wherever it is already in someone's list.

## Search aliases (V95/V96)

Lifters type "OHP", "RDL" and "military press"; the library says "Barbell Overhead Press" and
"Romanian Deadlift". `exercise_aliases` holds the other names of 47 library exercises, sent on
`ExerciseDto.aliases`, and the picker's search (`utils/exerciseSearch.js`) matches them after the
name. It also matches the muscles an exercise mainly works, after aliases, so "hamstrings" lists
what trains them. A result found either way says so under its name ("Also called OHP", "Works
Hamstrings"), because nothing in the name is highlighted.

- **Search only, never identity.** The duplicate-name check on create stays on the name, so an alias
  can never silently turn somebody's "Military Press" into the library row. History, PRs, the CSV
  round trip and the History filter never see an alias.
- **Curated, not imported.** Only names people actually type: abbreviations, the name without its
  equipment, and well-known synonyms. Loose synonyms that name a different movement are left out (a
  stiff-leg deadlift is not a Romanian deadlift). An alias that is another library exercise's name,
  or one shared by two exercises, fails `LibraryExerciseAliasesTest`.
- **The library expansion will need more of these.** Each new library exercise should arrive with
  its common other names in the same migration.

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

