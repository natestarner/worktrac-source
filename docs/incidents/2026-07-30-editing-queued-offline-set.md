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

## ⚠️ STILL OPEN as of 2026-08-18 — the edit is sometimes lost for real

**This is a live bug with a reproduction, not an expected failure.** It is recorded here rather
than as a new `docs/incidents/` entry because that directory is for *resolved* post-mortems, and
because this is the same flow the fix above describes.

`e2e/tests/parity-active-loop.spec.ts`'s **"correcting a just-logged set applies immediately"**
fails intermittently — measured **3 of 8 runs**, in `lie-fi` and `hard-offline` alike. It is easy
to dismiss as flake. It is not.

What was established 2026-08-18:

- **It fails at `afterReconnect`, not the in-mode assertion.** That assertion runs *after*
  `waitForOutboxDrain`, so it is a claim about the FINAL state, not the "brief revert-then-correct
  flicker" this document sanctions above. Do not conflate the two: the sanctioned flicker is
  transient and self-correcting; this is terminal.
- **The DOM at failure reads `This session  Set 1  0 lb × 8`** — the corrected value has reverted
  to the value originally logged.
- **The loss is SERVER-SIDE.** A throwaway spec ran the same flow and then *reloaded the page*,
  discarding all client cache and optimistic state. In 1 of 4 runs the server still returned `0`
  after the reload. A refresh does not recover it; the correction is gone.
- **It is not caused by the log-screen reconciliation work landing alongside this note.** Measured
  like-for-like: 8 runs on that branch (3 failed) and 8 runs on unmodified `main` (3 failed) —
  identical rate.

Real-world shape: log a set offline, correct it before it syncs, reconnect — and the correction is
sometimes silently discarded. That is squarely the scenario this app exists to survive.

Where to look (not yet investigated): the ordering between the create's replay and the dependent
`EDIT_SET` replay inside the shared serial outbox scope, `setIdMap`'s temp→real resolution timing
(`requireResolvedSetId`), and the backend's `WorkoutSetService#findDuplicate` idempotency dedup —
which, per the analysis above, "returns the committed row *ignoring the new payload*". The comment
in the spec itself names that dedup as the suspected mechanism.

Reproduce with:

    cd e2e && bash ../scripts/e2e.sh parity-active-loop.spec.ts \
      -g "correcting a just-logged set applies immediately" --repeat-each=8

To tell server-loss from client-staleness, reload the page after the drain and re-read the row: if
it still shows the pre-edit value, the server has it too.
