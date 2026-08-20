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

### Handing a row OFF those fallbacks must OVERLAP, and `tempId` is the hinge

A pending row leaves `pendingBeforeSession` the instant its mutation reports `success`
(`isUnsyncedWrite`). Nothing else was putting it back: on the FIRST set of a workout `onMutate` had
no session id to write an optimistic `sessionSets` row against, and `contextSessionId` was still
null pending a `liveSession` refetch. So the set vanished for **two sequential round trips** and the
"This session" card unmounted around it. The same `null -> real` key flip cold-keyed
`exerciseSummary`, dropping the summary cards to skeletons and blinking the steppers through an em
dash (`prefill` derives from `summary.lastSession`).

`LOG_SET`'s `onSettled` (`queryClient.js`) closes it by reconciling **from the response** instead of
refetching to discover what the response already carried — `LogSetResultDto` holds the same
`WorkoutSessionDto` and `WorkoutSetDto` records the two GET endpoints return. Three things there are
load-bearing together:

- **The confirmed row is seeded carrying `vars.tempId`.** That single field is what couples the two
  halves: `pendingBeforeSession`'s exclusion predicate matches `real.id === tempId ||
  real.tempId === tempId`, and the row's React key is `set.tempId ?? set.id`. Drop it and you get
  BOTH the flash back (the row unmounts and replays `set-row-new`) and a transient **duplicate**
  row — `setQueryData` and the `success` dispatch are separated by an `await` inside TanStack's
  `execute()`, so `notifyManager` can flush a render between them.
- **The seed REPLACES a matching optimistic row in place; it does not append.** Sets 2+ and
  session-edit mode *do* get an `onMutate` row (keyed on the tempId), and appending beside it paints
  the same set twice.
- **The session promotion is guarded on `mode !== 'session'` and `isSessionEnded`.** A
  `mode: 'session'` response carries the PAST session being edited, not the live one; and a set
  replaying after End Workout must not resurrect a finished session into the cache.

**None of this may become a connectivity branch.** It sits behind `if (data?.set?.id &&
data?.session?.id)`, and `data` is non-undefined only when the server answered — so it is
unreachable while paused offline (never settles), under lie-fi or a definitive 4xx (settles with
`data === undefined`), and against a 5xx/cold start. That is why it needs no row on
`resilience.md`'s register. `queryClient.test.js` asserts the inertness directly, and
`e2e/tests/parity-first-set.spec.ts` samples the row count **per animation frame** across all four
modes — a retrying matcher cannot express "this was never absent", it just waits the bug out.

Known and pre-existing, NOT introduced by the above: mid-drain, `displaySets` prepends
`pendingBeforeSession` on the assumption those rows are "chronologically the earliest", which is
untrue once one queued set has confirmed and later ones have not. The order churns transiently while
an outbox of several sets drains. Before the reconciliation above, that window also **dropped rows
entirely** (3 -> 2 -> 1 on a three-set drain); it now keeps every row and only reorders.

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
- **The Time value opens a picker, and Weight/Reps deliberately do not.** `WeightRepsStepper`'s
  `onPick` is the Time field's third mode: the value becomes a read-only `<input>` that opens
  `DurationPickerSheet` (a min/sec wheel — `DurationWheel` — in `Modal align="bottom"`). The
  asymmetry is the whole justification, so don't "unify" it: a numeric keypad expresses a weight
  or a rep count exactly, and cannot express `m:ss` at all, because it has no colon key. That gap
  is why `parseDuration` had to accept a bare second count in the first place — the field showed
  `1:30` while the only thing a thumb could physically type was `90`.
  - It stays an `<input readonly>` rather than becoming a `<button>`. A button takes its
    accessible name from its text content, which would replace `aria-label="Time"` with `"1:30"`
    and break both test layers at once. `readOnly` is also what suppresses the mobile keyboard.
  - **`DurationWheel`'s keyboard interface is load-bearing, not an accessibility afterthought.**
    Arrow keys, Home/End, PageUp/Down and **digit typeahead** are what answer the objection that
    removed the old `NumericKeypad` ("doesn't pop an unrequested keypad over a mouse-and-keyboard
    session"). It is also what the e2e helper drives — scroll-driving a snap container from a test
    means racing momentum physics for a value you then read back. Typeahead resets on blur so a
    keystroke's meaning depends only on the current visit.
  - `EditSetModal` renders the same wheel **inline** rather than opening the sheet: a sheet there
    would be a modal over a modal — two scrims, two focus traps, and an Escape whose target you'd
    have to guess.
  - **Turning the wheel is not a decision — only Done is.** `DurationPickerSheet` holds the value
    as local draft state, so the header X and Escape both discard. This is the same principle as
    "a modal never closes on a backdrop tap", pointed the other way: if closing *kept* the value,
    a stray Escape mid-set would silently **overwrite** a time rather than silently discard an
    edit. `EditSetModal`'s inline wheel needs no Done of its own because that modal already has
    the pair — Cancel discards, Save commits.
  - **The sheet has no footer Cancel, and adding one back is the bug.** It had one, and it was a
    second control for an act the header X already performs — same `onClose`, same meaning, on a
    row read one-handed mid-set. This is a deliberate divergence from the thirteen modals that do
    carry a `cancelButtonStyle`/submit pair: those are centred dialogs whose footer is the whole
    exit vocabulary, whereas a short sheet puts the X within the same thumb's reach as the
    controls. `DurationPickerSheet.test.jsx` asserts the dialog's buttons are exactly
    `Close, Clear, Done`, so a Cancel restored "for consistency" fails there.
    - **Clear then takes the vacated slot, and the two split the row as equal `flex: 1` halves**
      — the same shape `cancelButtonStyle` gives the other thirteen modals. Equal widths are what
      put the gap between them on the sheet's centre axis, where it lines up with the wheel's
      colon directly above; that shared axis is what makes the footer read as settled under a
      centred wheel. Three earlier placements were rejected on sight — don't re-derive them:
      Clear alone at the far left (flush to the content edge, and again optically aligned past it
      so its glyphs met the selection band) read as a control that had drifted out of the row,
      and a right-grouped pair at their natural widths left the footer visibly heavier on one
      side than the wheel above it. Hierarchy is carried by **weight** instead: a ghost Clear
      against a filled Done. Their gap is `--space-3` rather than the old pair's `--space-2`,
      because Clear's neighbour is now the button that commits.
  - **`0:00` on the wheel means *unset*, and commits as `null`.** That one rule is what makes the
    sheet's **Clear** button work, and three earlier attempts at it were each wrong in an
    instructive way — don't re-derive any of them:
    1. *Clamping inside the wheel* snapped it back from `0:00` under a finger still moving, and
       made Clear a lie: the button claimed an empty state the control then refused to show.
    2. *Clamping on the way out* meant you cleared to `0:00`, pressed Done, and the field read
       `0:01` — the app silently overruling a number you had just chosen.
    3. *Disabling Done at `0:00`* (what a platform countdown timer does) is honest but a **dead
       end here**: it leaves no way to commit the thing Clear just did. A countdown timer has no
       "unset" to fall back on, so refusing is all it can do. This screen does have one.

    `null` is already how Weight and Reps say "no value chosen yet" (an em dash), and **blank must
    never be a validation gate** — see the prefill section above. So a cleared duration lands in
    exactly that state, `Log set` still works, and `durationValue`'s `?? 30` supplies the default
    at log time exactly as `weightValue`'s `?? 0` does. `null` is not `0`, so the `@Min(1)` floor
    is untouched by any of this.

    **The `−` button follows the same rule**, on both screens: stepping off the bottom (from
    `0:05` or less) goes to empty/`0:00` rather than parking on `0:01`. A minimum left sitting in
    the field reads as a deliberate one-second hold, and it gives the last press of `−` nothing to
    do. **No duration control clamps on its own** — the floor lives on the commit, and only there.

    `EditSetModal` differs in what the bottom *means*, not in whether `−` can reach it: an
    already-logged set has no blank to fall back on, so it has no Clear, `0:00` is simply not
    saveable, and its Save is `disabled` below `MIN_HOLD_SECONDS` (the same answer
    `DurationPickerSheet` cannot give, because there Clear must stay commitable). Its `−` used to
    clamp at the minimum and was the one control out of step; it now reaches `0:00` like its own
    inline wheel already could. The dead end is one press of `+` wide, which is what makes
    refusing acceptable there and unacceptable on the log screen.
  - The sheet caps its width via `Modal`'s `width` prop. For `align="bottom"` that prop is a
    **max**-width, not a width: full-bleed on a phone, and not a 1400px band of controls on a
    desktop monitor.
  - `onPick` is suppressed while `holdRunning` — the field is then a live readout of the timer,
    and a picker onto a number moving underneath it has no coherent answer for what happens when
    you let go.
- `formatRestTime` still renders the field in **both** states, and `parseDuration` still backs
  `EditSetModal`'s stepper. The two halves must stay in step: formatting as m:ss while parsing
  with `parseFloat` reads "1:30" as 1.
- **A hold's duration is floored at `MIN_HOLD_SECONDS` (`utils/datetime.js`), and every path that
  can commit one must agree** — the ± steppers clamp, the two picker commits *refuse* (see above),
  and `handleLogSet` clamps as the last line before the wire.
  `LogSetRequest`/`EditSetRequest` declare `durationSeconds` `@Min(1)`, so a 0 is
  a 400 — and a definitive 4xx is the one thing that ends a durable write's retries, so a
  0-second hold isn't rejected with a chance to fix it, it's **discarded for good** behind a
  "Couldn't save that set" toast. `0:00` is the top of both wheel columns, i.e. one flick away.
  The `handleLogSet` clamp is not redundant with the control clamps: it also covers a hold stopped
  the instant it started, and a draft persisted by a build that predates the floor.
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


### The rest timer counts UP, and lives in two places at once

`RestTimerBar` is gone. The rest timer has no overlay of its own: it renders as a readout in
`SessionBar` (fixed bottom chrome, `components/layout/`) and as a ring on every person's pill in
`PersonPillBar`. `restTimers[personId]` is `{ startedAt, targetSeconds, elapsed, capped }`.

- **It counts up toward a target, never down to zero, and that is not cosmetic.** A full ring is a
  stable "you're ready" state that holds indefinitely; a drained one at zero is empty, i.e.
  visually identical to "not resting". Counting up also preserves **overrun** — the old
  self-destruct-at-zero destroyed the difference between going at 0:90 and sitting for five
  minutes, a number `workout_sets.rest_seconds` already records on every set.
- **`targetSeconds` is snapshotted at `startRestTimer` and never re-derived.** The obvious
  implementation looks it up from `selectedExerciseId`, but that is what the person is *looking
  at*, not what they last logged — browse from bench to curls without logging and the ring jumps.
- **There is a 10-minute ceiling, and a capped timer must stay in the map while leaving
  `hasActiveTimers` false.** Counting up has no natural end, so without it a forgotten timer keeps
  the shared 200ms ticker alive forever. Dropping the entry instead would blank the ring for
  someone who genuinely still hasn't gone.
- **Both numbers come from `UIContext`, never from `sessionSets`.** "Elapsed since the last set in
  this session" reads like a query, but `contextSessionId` is `null` for a person's entire
  offline/lie-fi stretch, so any query keyed on it never runs — that would ship a live ring above a
  blank readout for the whole outage. One clock, client-side, wall-clock derived.
- **`startedAt`/`targetSeconds` are persisted to `AppStateContext`** (localStorage, synchronous) so
  `swUpdate.js`'s silent post-deploy reload resumes the timer instead of destroying it — the same
  treatment `holdStartedAt` gets, for the same reason. `AppShell` resumes on mount and **discards a
  start already past the ceiling** rather than restoring three days of elapsed.
- **The resume covers EVERY person, not just the active one, and `SET_REST_TIMER` therefore takes
  a `personId`.** This is the one projection that reads across `byPerson`
  (`selectRestTimersByPerson`), and it has to be: the ring answers *"is anyone ELSE ready to go"*,
  so an active-person-only resume blanks precisely the rings the feature exists for. It shipped
  that way — after a reload the other person's ring was gone until you switched to them, which
  restored their timer as a side effect of them becoming active. **A one-person household cannot
  reproduce it**, which is why it got through; the guards are `AppShell.test.jsx`'s resume block
  and `multi-person.spec.ts`'s reload spec, both verified against the old behaviour.
- **Every path that ends a rest must clear BOTH copies in one synchronous step** — ending the
  workout (`EndWorkoutConfirmModal`) and starting a hold (`ExerciseDetail`). Clearing only the
  in-memory one leaves the persisted start for the next mount to resume, which is the same
  resurrection `endedSessions.js` exists to prevent for the live session.
- **No `+30s`, no `−15s`, no Skip.** `+30s` negotiates with a deadline that has no authority, and
  Skip duplicates what logging the next set already does. Logging the next set restarts it.
- **The target resolves through `utils/restTarget.js`**, not a literal at the call site. It returns
  the app default for everyone today; the per-person and per-exercise columns drop into that one
  function plus their two write surfaces, because every consumer already reads the snapshot.

## Routine stepping is index-based, and that is load-bearing

A routine may list the same exercise more than once (bench, row, bench). `AppStateContext`'s
`routineIndex`, `JUMP_TO_ROUTINE_INDEX`, `NEXT_EXERCISE_IN_ROUTINE` and `LogTab`'s pill strip
(`key={`${exerciseId}-${idx}`}`) are all keyed on **position**, never on exercise id. Resolving the
current step by exercise id would collapse the duplicates back together.

Two consequences that are correct, not bugs: with *adjacent* duplicates "Next exercise" leaves
`selectedExerciseId` unchanged, so only the pill and the "n of m" counter move; and both positions
write into the same exercise's single set list for the session, which is the whole point of
cycling back.

### Every routine control lives in the card, and none of them may be gated on `selectedExercise`

`LogTab`'s routine card renders above **both** the picker and the exercise screen, which makes it
the only chrome present for the whole life of a routine. That is why it carries the controls, and
why a gate on `selectedExercise` is wrong on any of them: the picker is a normal mid-routine
place to be (back out, log something off-script, resume), and a gated control leaves a position
readout there with nothing but the pills to act on.

- **`Next exercise` / `Finish routine` is deliberately ungated.** It briefly wasn't: the condition
  came along verbatim in #64 when the button moved up out of `ExerciseDetail` (which only renders
  *with* an exercise open), so it was incidental, never a decision. From the picker the label still
  means what it says — it advances a step and opens it.
- **`End routine` is the early exit, and it must stay reachable from step 1.** Before it, the only
  control that cleared routine state was `Finish routine`, which appears on the **last** step
  alone — so leaving a routine early meant stepping through the remainder or scrubbing the pill
  strip to its end and tapping in. Reaching the end is not a precondition for stopping.
- **The two exits are not redundant, and neither should be folded into the other.** `Finish
  routine` steps *past* the last index: `NEXT_EXERCISE_IN_ROUTINE` clears `selectedExerciseId`, so
  it ends with a "Routine complete!" toast back on the picker. `END_ROUTINE` deliberately leaves
  `selectedExerciseId` **alone**, so bailing out drops the routine chrome and leaves the person on
  the exercise they were on, free to keep logging off-script.
- **No confirm dialog on `End routine`.** It clears client-side navigation state only — nothing
  logged is touched, and the routine restarts from the picker's quick-start list, which
  `ExercisePicker` shows precisely when no routine is active. A modal would tax every deliberate
  use to guard an action with nothing to undo. (`EndWorkoutConfirmModal` is the opposite case: it
  ends a real session server-side, and calls `endRoutine()` on the way through.)

None of this is a connectivity branch — routine position is pure client state — so it does not
belong on `resilience.md`'s register.

## Creating an exercise selects it SYNCHRONOUSLY -- never behind an awaited refetch

`handleExerciseCreated` receives an **optimistic temp row** (`AddEditExerciseModal` always takes the
durable outbox path for the Log tab, even while genuinely online). `insertOptimisticExercise` has
already written that row into `queryKeys.exercises()` **and** `queryKeys.personExercises()`, so it
is selectable and searchable the moment the modal closes.

- **Do not refetch either key here.** Awaiting an invalidation of the two keys holding the row
  evicts it milliseconds before `selectExercise` names it -- `selectedExercise` resolves to `null`
  and `LogTab` falls back to the picker. `CREATE_EXERCISE`'s own `onSettled` already invalidates
  both, at the only moment a refetch can return the real row.
- **It reproduced ONLY while online**, because `invalidateQueries` on a paused query resolves
  immediately without fetching and a lie-fi refetch keeps its `data`. Every spec that created an
  exercise ran in a mode where it works, so it shipped and survived ten PRs. `assert` in
  `parity-exercise-create.spec.ts` now covers all four modes, and `LogTab.test.jsx` drives the
  create with never-settling refetch mocks -- restoring the await fails both.
- **The temp->real remapper needs a catch-up, not just its MutationCache subscription.** The
  subscription only sees mappings recorded from the moment it subscribes, so the effect also
  resolves `selectedExerciseId` through `resolveExerciseId` *before* subscribing -- a create that
  synced while `LogTab` was unmounted (another tab, during boot) otherwise strands a temp id
  forever. Don't move that resolution into the `selectedExercise` lookup: the id map is a mutable
  module singleton that triggers no re-render.

- **Because the screen is now reached before the create has synced, the temp->real swap happens
  under someone's thumb.** `CREATE_EXERCISE`'s `onSettled` therefore seeds the server's row into
  both exercise keys before invalidating; without that, `selectedExercise` is `null` for a full
  round trip and this screen unmounts mid-interaction. Don't reduce it back to an invalidation.

Mechanism and the general form of the rule: `.claude/rules/offline-internals.md`. Post-mortem:
`docs/incidents/2026-08-19-exercise-create-navigation-lost-online.md`.

## Editable temp rows

`editableTempIds` is what gives a paused/retrying/errored row its Edit and Delete controls
immediately instead of an indefinite "Saving…" spinner. "Saving…" is only for a write's first
in-flight attempt.
