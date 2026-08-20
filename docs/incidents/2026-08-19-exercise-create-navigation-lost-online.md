# Creating an exercise stopped opening it — online only

**Date:** 2026-08-19
**Area:** Log screen / offline machinery
**Shipped in:** #95 (`7b9df61`). Found ~10 PRs later, by a person using the app.

## Symptom

Tap **+ Add your own exercise**, type a name, tap **Add**. The modal closes and you are left on the
exercise picker. The exercise was created — it is in the picker, and its sets log fine once you tap
into it — but the app did not take you there, which is the entire reason you tapped the button
mid-workout.

Reproducible "regularly" while online. Not reproducible offline.

## Root cause

Two changes that were each correct, and a caller left between them.

`AddEditExerciseModal` has handed `onSaved` an **optimistic temp row** (`temp-exercise-<uuid>`)
since #95, which moved the Log tab's create onto the durable outbox path *even while genuinely
online* so that Save can never hang against a dead-but-reachable backend. That was the fix for a
real lie-fi bug and it should stay.

`LogTab.handleExerciseCreated` still had the shape it had when `onSaved` carried a real server row:

```js
await Promise.all([refetchPersonExercises(), refetchCatalog()]);
if (created?.id) selectExercise(created.id);
```

Both helpers are `invalidateQueries` over `queryKeys.exercises()` and
`queryKeys.personExercises(personId)` — **the exact two keys `insertOptimisticExercise` had just
written the new exercise into.** Online, those refetches return server data containing no temp row,
so the row was evicted milliseconds before `selectExercise(tempId)` named it. `selectedExercise`
resolved to `null` and `LogTab` fell back to `<ExercisePicker>`.

The temp→real remapper was supposed to rescue exactly this, but it is conditioned on
`selectedExerciseId === tempId` **at the instant the create's success event fires**. Online the POST
plus the favorite PUT often settle *before* the awaited invalidations let `selectExercise` run, so
the check failed and the remap never happened. That race is why it reproduced "regularly" rather
than always — in the other ordering you got a picker flash and then a jump.

## Why every test passed

The bug is invisible in all three degraded modes, and the flow had **no online coverage at all**.

| Mode | What the await did | Result |
|---|---|---|
| Hard-offline / pinned | `invalidateQueries` on a *paused* query resolves immediately without fetching | Temp row survived. Worked. |
| Lie-fi | Refetch failed; TanStack keeps `data` on error | Worked, after tens of seconds of retry backoff |
| Online | Refetch succeeded, replacing the array | **Broken** |

`offline-exercise-create.spec.ts` and `intermittent-errors.spec.ts` both exercise this flow, and
both run only in modes where it works. The lie-fi delay was even *observed* — `offline-durability`
carried a 15s wait and a comment explaining it — and recorded as a timing quirk rather than read as
the same bug showing its other face.

## Takeaways

1. **Never await an invalidation of a key that holds an optimistic row you are about to read.**
   `offline-internals.md`'s cache-warming table already said this about `refreshAfterRestore`
   ("refetching deletes it from the picker mid-flight"). The invariant was right; it was written
   as a fact about one call site instead of a rule about the key.
2. **Changing what a callback is handed is a change to every caller.** #95's own commit message
   noted "AddEditExerciseModal: online path unchanged" — true of the modal, and precisely wrong
   about the flow, because the *payload* changed from a server row to a temp one.
3. **An observed slowness in one mode deserves the same suspicion as a failure.** The lie-fi wait
   was the bug reporting itself, in the one mode where it degraded gracefully. Working around a
   product behaviour in an e2e helper is the same mistake as
   `2026-08-12-prefill-overwrites-typed-weight.md`.
4. **"It works offline" is not evidence it works.** Degraded modes can *mask* a bug by pausing the
   very request that causes it. `parity-exercise-create.spec.ts` now runs this flow in all four
   modes; reverting the fix fails `[online]` alone.

## The fix uncovered a second bug in the same seam

Fixing the navigation made the detail screen reachable *before* the create had synced -- which is
the point, and is what offline already did. But it also meant the temp->real migration now happens
while someone is **using** that screen rather than before they get to it, and the migration had a
hole of its own that nothing had been able to reach.

`CREATE_EXERCISE`'s `onSettled` recorded the id mapping and then merely **invalidated** the two
exercise keys. An invalidation marks a query stale; the real row does not arrive until its refetch
completes a round trip later. LogTab's selection, meanwhile, moves to the real id the instant the
mutation reports success. So for that entire round trip neither id was in either list,
`selectedExercise` resolved to `null`, and `ExerciseDetail` unmounted back to the picker.

Visible symptom: create a timed exercise and immediately tap the Time field, and the tap does
nothing -- the duration picker never opens, because the screen it was opening on was replaced
underneath it.

`onSettled` now swaps the optimistic row for the server's row **in place, before invalidating** —
the same reconcile-from-the-response rule `LOG_SET` already follows, and inert in the same way
(`created?.id` is only truthy when the server actually answered).

**How it was caught, and how it nearly wasn't.** `endurance.spec.ts`'s "a household can add its own
timed exercise" failed in the full suite and *passed in isolation* — the exact shape that gets
written off as parallel-run flakiness. Two things stopped that: it failed identically across two
consecutive full runs, and a control run of the same specs on stashed `main` was **32/32 green**.
Per `.claude/rules/e2e-tests.md`, the failing-test-moves heuristic is weak; the control run is what
turns "probably flaky" into "definitely mine".

## Fix

`handleExerciseCreated` selects synchronously off the optimistic row and does not refetch — the
create's own `onSettled` already invalidates both keys once the server confirms, which is the only
moment a refetch can return the real row. The remapper additionally resolves through
`exerciseIdMap` before subscribing, so a mapping recorded while `LogTab` was unmounted (another
tab, or during boot) is not missed.
