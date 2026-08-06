# The durable outbox could still reorder (and, on a second reload, re-deadlock) under lie-fi, despite the 2026-07-29 fix (2026-08-01)

- User report: queued writes in the "N changes waiting to sync" list still visibly changed order
  under lie-fi, "particularly painful when there are dependencies" — even after the 2026-07-29 fix
  above. Investigation confirmed that fix did *not* regress: the live serial outbox scope (no
  reload involved) genuinely replays in registration order, proven by
  `intermittent-errors.spec.ts`'s continuous-lie-fi create+set test. The defect was narrower and
  specifically about *reconstructing* order across a reload.
- Root cause: `restoreOutbox`'s registration-order fix keyed everything off TanStack's own
  `state.submittedAt` — but that's a framework timestamp, **re-stamped to "now" every time a
  mutation is re-executed**. `restoreOutbox`'s re-dispatch of a not-paused (lie-fi) write did not
  preserve its original `submittedAt` (only `flushOutbox`'s stuck-retry path did that, via an
  explicit capture/restore). One reload was enough to make that write's `submittedAt` **display**
  out of order in `useOutboxItems` (which also sorted by `submittedAt`) even though the underlying
  scope replay was still correct that one time. A **second** reload was worse: the drifted
  `submittedAt` from reload #1 would now sort *actually wrong* on reload #2's registration pass,
  reintroducing the exact 2026-07-29 deadlock (a dependent write registered ahead of the create it
  depends on, permanently blocked on `requireResolvedExerciseId`'s retryable-forever error).
  Ordinary lie-fi use supplies "a reload or two" without the user ever manually reloading, via
  `swUpdate.js`'s silent forced reload on an ordinary person/section switch.
- **Takeaway:** replaced the mutable `submittedAt` ordering key with an immutable, monotonic,
  app-assigned `enqueueSeq` (`frontend/src/lib/outboxSequence.js`), stamped once into a durable
  write's own `variables` at first dispatch (`dispatchDurableWrite` / the `useDurableMutation` hook
  wrapping every component-level durable `useMutation`) and never touched again — the same
  principle `clientLoggedAt` already applies to rest-time math (see Data Model Notes above) and
  `pendingBeforeSession` already applies to sorting still-unsynced sets. `restoreOutbox`,
  `flushOutbox`, and `useOutboxItems` all sort by this key now (`byEnqueueOrder`), which **deletes**
  the fragile "capture and restore `submittedAt` around every re-execute" pattern entirely — there
  is nothing left to preserve, so the class of bug where a future call site forgets to preserve it
  is structurally impossible. Also fixed the one other place still keying off mutable `submittedAt`
  for a "pick the newest" comparison: `ExerciseDetail.jsx`'s `pendingLiveNote`. **Rule for any future
  ordering/"pick latest" logic over queued mutations: key off an immutable, app-assigned value
  (`clientLoggedAt`, `enqueueSeq`), never TanStack's own `submittedAt`.**
- Also closes a latent rest-time (`rest_seconds`) correctness gap noted during investigation, not
  just the reported display/deadlock symptom: `WorkoutSetService.computeRestSeconds` computes rest
  once at insert time against whichever set is currently the most recent in the DB, so replaying two
  live sets of one exercise out of order (the same submittedAt-drift bug, no create dependency
  needed) could silently produce a `null` rest for the true second set and a negative one for the
  true first. Guaranteeing in-order replay across any number of reloads fixes this as a side effect.
- New regression coverage added specifically for the reload-reconstruction path (not just the live
  scope, which 2026-07-29's tests already covered): a double-reload-under-lie-fi test and a
  connectivity-*transition* test (offline → lie-fi drift, not just two static starting cohorts) in
  `outboxPersistence.test.js`, a scrambled-persisted-array-order test proving the sort actually
  re-orders (not just preserves already-ordered input), and a `useOutboxItems` test proving the
  *displayed* list order survives a reload. Full investigation narrative:
  `git log --grep="enqueueSeq\|outbox.*reorder" -i`.

