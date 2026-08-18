# Editing a still-queued offline set could reorder it, or silently lose the edit (2026-07-30)

- Follow-up to the entry above. Two related problems in `offlineSetEdits.js`'s
  `replacePendingLogSet` (used whenever `EditSetModal` saves a change to a set that hasn't synced
  yet): (1) it removed the pending `logSet` create and re-dispatched a fresh one, which — like the
  bug above — always re-registers at the *end* of the shared outbox scope's array, so it could
  still jump ahead of/behind other queued writes within the same session (only a *subsequent
  reload* self-corrected it, via the already-fixed `restoreOutbox`). (2) More seriously: the
  re-dispatched create kept the SAME `idempotencyKey` as the original. If that original create had
  already reached the server under lie-fi (response lost, or a retry landed after a dropped first
  attempt), the re-dispatch collided with `WorkoutSetService.findDuplicate`
  (`backend/.../workoutset/WorkoutSetService.java`), which keys **only** on `idempotencyKey` and
  returns the already-committed row **ignoring the new payload** — so the edited weight/reps were
  silently discarded, with no error surfaced anywhere.
- Investigation also confirmed a hard constraint against the "obvious" alternative fix (edit the
  queued create in place): traced against the exact pinned `@tanstack/react-query@5.101.2` source,
  there is **no public API to cancel an in-flight mutation's retry loop**, and calling
  `Mutation.execute(newVars)` on an already-`'pending'` mutation takes an internal `restored`
  branch that skips the `state.variables` update entirely — so even if cancellation weren't a
  problem, the UI wouldn't show the edited values. In-place editing was never viable.
- **Takeaway:** editing a pending set no longer touches its queued create at all. It's now a
  genuinely separate, durable `EDIT_SET` write targeting the create's `tempId`, resolved to the
  real set id via a new `frontend/src/lib/setIdMap.js` — structurally identical to
  `exerciseIdMap.js`'s existing temp-exercise-id resolution, just applied to a second entity.
  `LOG_SET`'s `onSettled` records the tempId→realId mapping on success (mirroring
  `CREATE_EXERCISE`'s); `EDIT_SET`'s `mutationFn` resolves through it via `requireResolvedSetId`,
  throwing the same status-less/retryable shape as `requireResolvedExerciseId` when the create
  hasn't synced yet, so the shared serial scope guarantees the create replays first. This makes
  editing a pending set behave identically to editing an already-synced one in every connectivity
  mode (online / hard-offline / lie-fi) — same code path, differing only in whether the target id
  starts temp or real — and fixes both problems above: the create is never removed or reordered,
  and there is no same-key re-dispatch for `findDuplicate` to collide with.
- **Accepted UX costs, deliberately not engineered away (documented here, not just in code, so a
  future change doesn't "fix" them into new special-casing):**
  - **A brief revert-then-correct flicker is possible on reconnect**, but *only* for a set edited
    before it ever synced. The create still commits its **original** value first (by design — see
    above), then the separate `EDIT_SET` applies the correction; each write's `onSettled`
    invalidates the relevant queries, so a refetch between the two could briefly repaint the
    original value before the corrected one lands. An already-synced set has no queued create in
    play, so this never happens for the common (online) case. Rejected fix: special-casing the
    hard-offline path to fold the correction into the create's own outgoing payload (avoiding the
    second write entirely) — this would require branching by connectivity mode at write time,
    reintroducing exactly the kind of mode-specific special-casing this whole redesign exists to
    get away from, for a cosmetic, self-correcting flicker.
  - **PR celebration can reflect the pre-edit value.** Because the create is never touched, a set
    that was a PR *as originally logged* can still trigger "New PR!" on sync even if it was edited
    down before reconnecting. This is a deliberate consequence of leaving the create alone, not an
    oversight — suppressing it would mean tracking "was this pending set edited" as extra state and
    threading it into PR detection, again the kind of special-casing being avoided. Narrow in
    practice (requires editing a PR-setting set before it ever syncs) and arguably more honest than
    the alternative (a PR you actually hit not being celebrated because you fixed a typo in it
    later).
  - Both costs are confined to "a set edited before it ever synced" — never afflict editing an
    already-synced set — and were an explicit, discussed trade favoring one uniform code path over
    chasing every polish case. See `git log --grep="editing a still-queued" -i` for the full
    design discussion.


---

## Follow-up (2026-08-18) — the correction was applied, then hidden by a stale cache key

Filed as issue #182 as an open, pre-existing, **server-side** data-loss bug, on the strength of the
symptom: `parity-active-loop`'s *"correcting a just-logged set applies immediately"* failed ~3 of 8
runs in `lie-fi` and `hard-offline`, at `afterReconnect` — i.e. after `waitForOutboxDrain` — with
the row showing the originally-logged `0 lb × 8`. **Every part of that characterisation was wrong**,
and how each was arrived at is the more useful thing to record.

### What it actually was

`reconcileSetChange` invalidated `session-sets(vars.sessionId, exerciseId)` — the session id
captured **at dispatch time**. For the one case this whole document exists to describe, correcting a
set logged before its session existed, that id is `null` and stays `null`: `contextSessionId` is
null for a person's entire outage (`ExerciseDetail.jsx`), so `EditSetModal` dispatches
`sessionId: null` and the write carries it forever.

So on reconnect:

1. `LOG_SET` replays, the server creates the session and the set at the **pre-edit** value, and its
   `onSettled` seeds `session-sets(<real id>, ex)` from the response and invalidates it.
2. That invalidation's refetch races the `EDIT_SET` replaying immediately behind it.
3. `EDIT_SET` succeeds — the server now holds the corrected value.
4. Its `onSettled` invalidates `session-sets(null, ex)`: an empty, unobserved query. The real key,
   which is what the screen reads, is left holding the pre-edit value **and marked fresh**.

Nothing refetched it again, so the applied correction stayed invisible until that query went stale
on its own 60s later. Whether it showed at all came down to whether step 2's refetch resolved
before or after step 3 committed — hence intermittent, and hence terminal rather than the
revert-then-correct flicker sanctioned above (that one is transient and self-correcting; this one
never corrected).

Fix: reconcile against the session id **the server reports**. `WorkoutSetDto` already carries
`sessionId`, so the PATCH response is authoritative — no backend change was needed. Same idiom
`LOG_SET` (`data?.session?.id`) and `SAVE_NOTE` (`data?.sessionId`) already use, for the same reason.

### Three wrong conclusions, and what produced each

- **"The loss is server-side."** Established by reloading the page after the drain and re-reading
  the row. But a reload cannot separate *lost* from *not applied yet*, and `waitForOutboxDrain`
  returns as soon as the edit un-pauses (`useOutboxCount` deliberately ignores a non-paused write
  with `failureCount: 0`), so the reload routinely beat the in-flight PATCH. Asking the API
  directly instead showed `weight: 10` on the server in **every** run, including every failing one.
  **A page reload is a client-state probe, not a server-truth probe.**
- **"Pre-existing — it predates the change that surfaced it."** Measured 8 runs on the branch and 8
  on `main`, got 3 and 3, and concluded "identical". Re-measured on one stack with only #181's two
  frontend files moving: **0/32 with them reverted, 13/32 with them restored.** Eight runs a side
  cannot distinguish 0% from 40%. The spec predating the change is not evidence either — it was
  passing.
- **"The mechanism is `WorkoutSetService#findDuplicate` discarding the edit."** Inherited from the
  analysis higher up this page, where it is real. It cannot apply here: the parity harness's lie-fi
  is `route.abort('failed')`, so no request reaches the server at all during the fault window, and
  hard-offline never dispatches. **A plausible mechanism already written down is the easiest thing
  to stop looking behind.**

### What #181 changed

#181 did not introduce the wrong key — that dates from this document's own redesign. It made it
*reachable*. Before it, `LOG_SET`'s `onSettled` only invalidated; `session-sets(<real id>, ex)` had
no observer and no data, so it was first fetched only after a `liveSession` refetch flipped
`contextSessionId` — a full round trip later, by which time the edit had long committed. #181
promotes the session and seeds that key synchronously from the response, which is what put the
refetch in a genuine race with the edit. A latent defect became a ~40% one.

Guard: `queryClient.test.js`'s *"EDIT_SET reconciles against the session the server reports"*,
asserted against a real cache rather than a spy on `invalidateQueries` — a spy passes just as
happily on a key nothing observes, which is the bug itself.

