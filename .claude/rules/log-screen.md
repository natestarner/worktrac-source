---
paths:
  - "frontend/src/components/log/**"
---

# Log screen (`ExerciseDetail.jsx` and friends)

The densest file in the app for cross-cutting invariants. Full narrative:
`docs/architecture/offline-mode.md` and `docs/architecture/data-model.md`.

## ⚠️ Cross-file coupling: which endpoint you call decides `rest_seconds`

`handleLogSet` picks between two backend endpoints, and that choice — not any flag — is what
determines whether `workout_sets.rest_seconds` is recorded:

- `POST /api/people/{personId}/live-sets` (real-time logging) → backend `logLiveSet` → rest time
  **is** computed.
- `POST /api/sessions/{sessionId}/sets` (explicit "editing a specific existing session" mode) →
  backend `logSetIntoSession` → rest time is **always null**.

`logSetIntoSession` is only ever called from this explicit editing mode. If that ever changes,
the backend's rest-seconds rule silently breaks — see `.claude/rules/workout-data-model.md`.

Live-set writes should carry `clientLoggedAt` so a set logged now but synced later keeps an
honest `created_at`, and therefore an honest rest gap.

## The three pending-value fallbacks — don't remove them

`contextSessionId` (`liveSession?.id || editingSessionId`) stays `null` for a person's **entire**
offline/lie-fi stretch: the placeholder `liveSession` seeded by `logSetMutation.onMutate` is
deliberately `{ id: null }` so it can never leak in, and the real id only arrives once the
create-session round trip reaches the server. Every query keyed on it (`sessionSets`,
`sessionExerciseNote`, `exerciseSummary`) is `enabled: !!contextSessionId` and never runs during
that window.

Three fallbacks close that gap:

1. **`pendingBeforeSession`** — unsynced sets, read from the log-set mutation's own variables via
   `useMutationState`.
2. **`derivedSummary`** — the "Last time"/"Best est. 1RM" card, derived from the already-warmed
   `history` cache (`utils/exerciseSummaryFromHistory.js`). Because `history` is unpaginated this
   is the *same* answer the backend would give **for everything already synced** — see the next
   section for the part it cannot see.
3. **`pendingLiveNote`** — a session note saved before/without a synced session, read from the
   pending `SAVE_NOTE` mutation's variables the same way.

`pendingLiveNote`'s "pick the newest" comparison keys off **`enqueueSeq`, not `submittedAt`** —
see `.claude/rules/offline-internals.md`.

**The provisional `{ id: null }` liveSession must never count as fresh.** `onMutate` seeds it with
`setQueryData`, which stamps `dataUpdatedAt = Date.now()` on a value the client invented — so once it
survives a reload it satisfies every staleness check and nothing ever fetches the real session id.
`contextSessionId` then stays null *after* connectivity returns and the outbox has drained, and the
person's synced sets are missing from "This session" entirely. `useLiveSession`'s `staleTime` is a
function for exactly this reason — don't flatten it back to a number
(`docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md`).

## Anything derived from `history` must also fold in the unsynced sets on screen

`history` and `exerciseSummary` are only ever **invalidated** after a write, never optimistically
written (`queryClient.js`) — and invalidation is a no-op while a query is paused or its refetch is
failing. So a value derived from `history` alone freezes at the moment connectivity dropped, while
`displaySets` keeps growing for the rest of the offline/lie-fi stretch.

That gap put the PR pill on the **wrong row**, not merely missing: `isPrSet` asks "does this *tie*
the all-time best", so against a frozen best a genuine offline PR went unbadged while a later,
lighter set that happened to tie the *pre-offline* best got badged instead. `effectiveBest`
(`mergeBestWithLocalSets`) closes it, and both the pill and the Best card read it.

- Fold **`displaySets`**, not `sessionSets` — while offline `onMutate` writes no optimistic
  `sessionSets` row at all (that branch needs a real `contextSessionId`), so `pendingBeforeSession`
  is the only source for those rows.
- Applied in **every** connectivity mode, not gated on `isPaused`/`isError`. Folding is a `max`, so
  online it's a no-op except in the window before the post-write refetch lands.
- **Known gap:** because it's a `max` it can only ever *raise* the best. An offline **delete** or
  downward edit of an already-synced set that was the all-time best leaves the best stale-high
  until the outbox drains. Symptom is a *suppressed* badge, not a misplaced one.

**When adding any other value derived from `history`, ask:** would it be wrong for a person who has
logged sets that haven't synced yet?

## Three "is this a PR" predicates coexist on purpose — don't unify them

| Predicate | Where | Question it answers |
|---|---|---|
| strict `>` vs previous best | `WorkoutSetService#insertSetAndDetectPr` | "did this set beat my best" → the celebration |
| strict `>` running best | `historyPrFlags.js`, `StatsService#getExerciseTrend` | "was this a PR *when recorded*" → History ★, trend dots |
| `\|Δ\| < 0.5` tie with best | `formulas.js#isPrSet` | "is this my best" → the Log screen pill |

The Log pill is the odd one out **deliberately**: it marks *"this is your best"*, so a repeat of an
identical best stays flagged. The visible consequence is that hitting your best three times stars
one row on History but pills all three on Log. That is intended — **don't "fix" one into another.**
`historyPrFlags.js`'s header explains why a backend fold was rejected for History's markers.

## Weight prefill: blank, then today, then last session

`utils/formulas.js#computePrefillDraft` resolves in one fixed order — the prior session's set at
the same index, else **the last set logged today**, else `weight: null`. Three things must hold:

- **`null` is a display state, not a validation gate.** `ExerciseDetail` renders it as an em dash
  and `handleLogSet` sends `weightValue` (`weightDraft ?? 0`). Blank must never disable "Log set":
  0 is exactly right for a first-ever pull-up or plank, and 0 already means "bodyweight"
  everywhere downstream (`comparableLb`, `prSort.isBodyweight`, the backend's `bodyweightOnly`).
  The old 45 lb default was right only for a barbell.
- **The effect reads `displaySets`, never `sessionSets`** — and is declared below `displaySets`
  for that reason. Offline, `contextSessionId` stays null for the person's whole outage, so the
  `sessionSets` query never runs and its data stays `[]` however many sets they log. Reading it
  would freeze the set-index walk at set 1 *and* silently disable the carry-forward, online-only.
  `parity-active-loop.spec.ts` asserts the carry-forward across all four modes.
- **The carry-forward is the no-prior-session fallback only.** It must never override the
  set-index walk, which is the more informative answer whenever a prior session exists.

### The draft is stamped, and the stamp is what decides

`weightDraft`/`repsDraft` are **per-person** state (`AppStateContext`, mounted above the router)
describing a **per-exercise** value the person may also have typed by hand. Three more fields say
which: `draftExerciseId`, `draftSetCount`, `draftSource` (`'prefill' | 'user'`).

- **Never paint the stored draft without checking the stamp.** `ExerciseDetail` derives
  `shownWeight`/`shownReps` **during render** — stored draft only while `userOwnsDraft`, else the
  freshly computed `prefill`, else `null` (em dash). An effect cannot do this job: it runs after
  paint at best, and not at all until this exercise's summary lands, which is how the *previous*
  exercise's numbers used to show through. The effect that remains only *records* the seed.
- **`draftExerciseId` must be checked on both switch paths.** `LogTab` renders `ExerciseDetail`
  under `selectedExercise &&`, so the picker path unmounts and remounts it while the routine strip
  swaps the prop without unmounting — and the draft outlives both. `key={exercise.id}` fixes
  neither and would break the routine path.
- **Re-seed on `displaySets.length > draftSetCount`, never `!==`.** The count is transiently `0`
  while `sessionSets` reloads after a remount; `!==` reads that as "a set was logged" and destroys
  a value the person typed before stepping away.
- **One `SET_DRAFT` writes both numbers and the whole stamp.** There is deliberately no way to set
  weight without reps: a partial write stamps the new exercise while the other field still holds
  the old one's value.
- **Only an exercise change or a set actually being added may re-seed over `source: 'user'`.** Not
  a background revalidation, not the window-focus refetch `staleTime: 0` guarantees, not a pending
  row reconciling. `docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md`.
- Reps has a `null`/em-dash state for the same reason weight does — an honest blank beats another
  exercise's rep count. `repsValue` (`?? 8`) is what gets logged, mirroring `weightValue` (`?? 0`).

`WeightRepsStepper`'s value is a real `<input>` that **selects its text on focus**, so the first
keystroke replaces the prefilled value instead of appending to it. Without that, tapping a
prefilled 135 and typing 225 produced 135225, so every exact entry began by backspacing the
prefill out. (A custom on-screen `NumericKeypad` modal used to fake this with a manual "fresh
buffer" flag; the native input gets the same behaviour from the platform, for free, and doesn't
pop an unrequested keypad over a mouse-and-keyboard session.) It commits on blur/Enter, not on
every keystroke — see the component's header comment for why a plain controlled input can't
support typing a decimal digit by digit.

## The second stepper's meaning is the whole endurance feature

`isDuration = exercise.trackingType === 'duration'` is the single flag. Same screen, same two
steppers, same one `variant="primary"` — only the second stepper changes from **Reps** to **Time**
(m:ss, ±5s). **This is not a connectivity branch**, so it does not belong on `resilience.md`'s
register; that list is specifically for behaviour that differs by network state.

- `handleLogSet` sends exactly one measure: a hold carries `reps: 0` and `durationSeconds`, a lift
  carries `reps` and `durationSeconds: null`. See `workout-data-model.md` for why reps is 0.
- **`durationSeconds` must be selected in `pendingBeforeSession`'s `useMutationState` projection.**
  It is the only source of those rows while `contextSessionId` is null (a person's whole outage),
  so missing it renders a hold correctly online and blank in all three degraded modes.
  `parity-endurance.spec.ts` fails in exactly that shape — verified by breaking it.
- `mergeBestWithLocalSets`/`deriveBest` rank through **`comparableValue`**, not `comparableLb`.
  Routed through `comparableLb` a hold's weight-0/reps-0 pair reads as a comparable of 0, the `max`
  silently becomes a no-op, and the PR pill lands on the wrong row for the whole outage.
- `WeightRepsStepper`'s `displayValue`/`parse` pair is what makes the Time field editable. The
  field shows m:ss in **both** states — a value that changes shape the instant you tap it silently
  teaches that only raw seconds are accepted — and `parseDuration` accepts **either** `m:ss` or a
  bare second count, because a phone's numeric keypad has no colon on it. The two halves must stay
  in step: formatting as m:ss while parsing with `parseFloat` reads "1:30" as 1.
- The **Start/Stop timer** button is `variant="dark"`, not `secondary`. The input card is already
  `--color-surface` with a `--color-border` edge and `.btn-secondary` is that exact pair, so a
  secondary button there is surface-on-surface and reads as a label rather than a control.

### The hold timer is wall-clock, and that is load-bearing

`UIContext`'s ticker drives `holdTimers` (up) beside `restTimers` (down) from **timestamps**, never
by counting interval fires. iOS throttles then suspends timer callbacks when the screen locks —
mid-plank, tap Start and set the iPad down, that is the normal case. A counted timer under-reports
by however long the screen was off. `startedAt` is also persisted through `AppStateContext`
(localStorage, synchronous) so `swUpdate.js`'s silent post-deploy reload resumes a max hold instead
of destroying it at 1:55.

**Stop fills the field; it does not log.** A mis-tap would otherwise commit a set, and "review,
then tap Log set" is what the primary button means on every other exercise.

Three details of that ticker are load-bearing together — changing one without the others regresses
something:

1. **It samples every 200ms, not every 1000ms.** A 1s cadence is set when the provider mounts,
   which has nothing to do with when Start was tapped, so `0:00` sat there for up to 2 seconds and
   read as "the timer didn't start". The displayed value is still whole seconds.
2. **Both updaters return `current` unchanged when the displayed number hasn't moved**, so React
   bails out and the 5x sampling rate still costs ~1 re-render/second. Without this it is a 5x
   render-rate regression on a context most of the app reads.
3. **The interval only exists while a timer is running** (`hasActiveTimers`). The provider lives for
   the whole app, so an always-on ticker fires forever to do nothing — and `RoutineFormModal.test`
   mounts the real provider with real timers, where that showed up as intermittent failures.

## Routine stepping is index-based, and that is load-bearing

A routine may list the same exercise more than once (bench, row, bench). `AppStateContext`'s
`routineIndex`, `JUMP_TO_ROUTINE_INDEX`, `NEXT_EXERCISE_IN_ROUTINE` and `LogTab`'s pill strip
(`key={`${exerciseId}-${idx}`}`) are all keyed on **position**, never on exercise id. Resolving the
current step by exercise id would collapse the duplicates back together.

Two consequences that are correct, not bugs: with *adjacent* duplicates "Next exercise" leaves
`selectedExerciseId` unchanged, so only the pill and the "n of m" counter move; and both positions
write into the same exercise's single set list for the session, which is the whole point of
cycling back.

## Editable temp rows

`editableTempIds` is what gives a paused/retrying/errored row its Edit and Delete controls
immediately instead of an indefinite "Saving…" spinner. "Saving…" is only for a write's first
in-flight attempt.
