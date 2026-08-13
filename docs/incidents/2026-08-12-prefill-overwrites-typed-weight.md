# 2026-08-12 — The weight prefill overwrote a weight the person had typed

## Symptom

A set logged at a weight nobody entered. You type `315`, tap **Log set**, and the set is recorded
at the previous session's weight — or at `0` on a first-ever exercise.

It almost never surfaced *as* that, though. `comparableLb` collapses to comparing reps at weight 0,
so a 315×2 deadlift logged as 0×2 is no longer a PR. What you actually saw was **a missing "New
PR!" celebration**, or a records/sort assertion reading a number nobody typed — a symptom one
screen away from the cause.

It was also invisible locally. The queries involved return in milliseconds against a local backend,
so the race was almost never lost; it went red only against a deployed one. It took lower red
exactly that way on 2026-08-08, after several green local full-suite runs.

## Root cause

`ExerciseDetail` seeded the weight/reps draft from an effect:

```js
useEffect(() => {
  if (!summary) return;
  const draft = computePrefillDraft(summary.lastSession, displaySets, defaultUnit);
  setWeightDraft(draft.weight);
  setRepsDraft(draft.reps);
}, [summary, displaySets.length]);
```

Both dependencies move for reasons the person did not cause:

- **`summary` identity** changes on any refetch returning different data. `summaryQuery` sets
  `staleTime: 0`, and the query client defaults to `refetchOnWindowFocus: true` — so the summary
  refetches every time the app regains focus. On an iPad mid-workout with a 90-second rest timer,
  looking away and back is the normal case, not an edge case.
- **`displaySets.length`** moves when a pending row reconciles into a real `sessionSets` row, or
  when `sessionSets` refetches — not only when a set is logged.

The worst ordering: log set 1 → its `onSettled` invalidation refetches the summary and session sets
→ against a cold-starting backend those land *seconds* later, by which time you have typed the
weight for set 2 → the effect re-seeds → the typed value is gone, and `handleLogSet` sends the
prefill.

The deeper problem is that the draft is **per-person state describing a per-exercise value that the
person may also have typed by hand**, and it carried no record of any of that — not which exercise
it belonged to, not what it was computed against, not whether it was the app's suggestion or the
person's own input. With nothing to distinguish "a stale suggestion" from "what they just typed",
every re-seed was equally entitled to win.

## Why it survived so long

It was **found and then worked around in the wrong layer**. `e2e/tests/support/exercises.ts` grew
`setStepperPair`, which re-verifies both steppers together immediately before submitting, and
`.claude/rules/e2e-tests.md` gained a section explaining the race and mandating `logSetAt`. Both
describe this bug accurately. Neither fixed it — they made the *tests* robust against it while
leaving every real user exposed. There was no incident entry, so the app-level defect had no home
and never got scheduled.

The lesson generalises past this bug: **a test helper that exists to work around a product
behaviour is a bug report.** If the helper needs to poll because the app might change a value out
from under it, the app is changing a value out from under the user too.

## Fix

The draft now carries a stamp — `draftExerciseId`, `draftSetCount`, `draftSource` — written
together with the numbers by a single `SET_DRAFT` action. `ExerciseDetail` derives what to paint
during render rather than from an effect, and re-seeds only when the person cannot still own the
value:

```js
const setLoggedSinceSeed = displaySets.length > draftSetCount;
const userOwnsDraft =
  draftExerciseId === exercise.id && draftSource === 'user' && !setLoggedSinceSeed;
```

Two details are load-bearing:

- **`>` not `!==`.** `displaySets.length` is transiently `0` while `sessionSets` reloads, which
  happens on every remount — and `ExerciseDetail` *is* remounted whenever you step back to the
  picker and reopen the exercise (`LogTab` renders it under `selectedExercise &&`). Keyed on "the
  count changed", that transient reads as "a set was logged" and destroys a typed value. Only an
  increase can mean a real addition. This was caught by walking the remount path during design, not
  by a test — the test came after.
- **One action, not two.** Independent weight/reps writes would let a partial update stamp the new
  exercise while the other field still held the previous one's value, which is the sibling bug
  (below) one field at a time.

## The sibling bug, fixed in the same change

The same missing stamp meant switching exercises painted the **previous** exercise's weight and
reps until the new exercise's summary resolved — one frame when cached, a full round trip when not,
the whole `retry: 2` window under lie-fi. `AppStateProvider` sits above the router, so the draft
outlives `ExerciseDetail`'s unmount on the picker path, and the routine strip swaps the exercise
without unmounting at all. Neither path had anything to reconcile the draft against the exercise on
screen.

Notably this is **not** observable in hard-offline or pinned-offline: there `derivedSummary` is
available synchronously from the warmed history cache, so the stale frame never gets painted. It is
observable online and under lie-fi. A parity spec that only checked the offline modes would have
concluded there was no bug.

## Takeaways

1. **A test helper that polls around a product behaviour is a bug report.** File it against the app.
2. **Client state that is per-X but displayed per-Y needs to say which Y it belongs to.** Otherwise
   the gap between them is only ever closed by an effect, and an effect is always at least one paint
   late.
3. **Derive during render what an effect would otherwise write back.** The effect is still the right
   place to *record* a decision; it is the wrong place to be the only source of what gets painted.
4. **A retrying matcher cannot assert "this was never shown".** `toHaveValue('')` waits the bug out
   and passes. The parity spec for this initially did exactly that — it passed against the unfixed
   code — and had to be rewritten to sample the field every animation frame.

## Invariants recorded

`.claude/rules/log-screen.md`, "Weight prefill" — the stamp, the `>` rule, and the single-action
write. `.claude/rules/e2e-tests.md` — `logSetAt`'s polling is now defensive rather than load-bearing.
