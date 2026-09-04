# 2026-09-04 — An orphaned edit wedged the outbox permanently

**Symptom (as reported):** offline, edit a set and then delete it. The edit still shows in the
"waiting to sync" list even though the set is gone. On reconnect, sync gets stuck on that edit —
and everything behind it stops too, **including sets logged later while fully online**. The app
keeps accepting writes that never reach the server. There was no way to recover short of logging
out, which discards the whole outbox and the session with it.

## What actually happened

1. Offline, logging a set queues a `logSet` create carrying `tempId = optimistic-<uuid>`.
2. Correcting that set queues a **genuinely separate** `EDIT_SET` write targeting the same tempId.
   That separateness is deliberate and correct — see
   [2026-07-30](2026-07-30-editing-queued-offline-set.md); the alternative silently discarded the
   correction.
3. Deleting the set called `cancelPendingLogSet`, which removed the **create only**
   (`ExerciseDetail.handleDeleteSet`, and `SessionSummary.handleRemove` identically). The edit was
   left pointing at a tempId that nothing would ever map — the create that would have recorded the
   mapping in `LOG_SET.onSettled` never ran.
4. On reconnect, `requireResolvedSetId` threw `UnresolvedSetIdError`. That error is **status-less
   on purpose**, so `shouldRetryWrite` classified it as transient and retried forever at a 30s cap.

Step 4 is the wedge, and it is the part worth internalising:

> Every durable write shares one TanStack mutation scope, and TanStack runs only the **first
> `pending`** mutation in a scope. A mutation stays `pending` for the whole of its retry loop. So
> one write that retries forever stops every write behind it, permanently.

That is the same head-of-line shape as
[2026-07-29](2026-07-29-outbox-replay-order-deadlock.md), reached by a different route.
`outboxPersistence.js`'s header had already named the mechanism exactly — *"since a retrying
mutation's status never leaves 'pending', it never releases the scope for anything else either"* —
but only for the ordering bug it was written about. Nothing generalised it into a rule that a write
which can **never** succeed must not be retried forever.

## The second entry point nobody had hit yet

Found while fixing the first, and reachable today on a Free plan: `CREATE_EXERCISE` rejected with a
definitive 4xx (a quota 403, a 400 on an unknown `trackingType`) settles in terminal `error` and
never records a temp→real mapping. Every `logSet` / `saveNote` / `favorite` queued against that temp
exercise id then throws the equally status-less `UnresolvedExerciseIdError` and wedges the queue in
exactly the same way. Fixing only the delete path would have left this open.

## The fix, in three layers

1. **At the source.** `cancelPendingLogSet` → `cancelQueuedWritesForSet`, which removes the pending
   create **and** every queued `editSet` targeting that tempId. Nothing is lost: the create was
   cancelled, so no server row exists and an edit against it is a logical no-op. It also makes the
   list honest — deleting a set makes its pending correction disappear with it.
2. **The backstop, closing the class.** `requireResolvedSetId` / `requireResolvedExerciseId` became
   dependency-aware. The temp-id error now carries `terminal`, set from a purely **local** check
   ("is the create still in the mutation cache, and has it not itself terminally failed?"), which
   `shouldRetryWrite` honours as its first clause. Still queued → retry, unchanged. Gone, or
   terminally failed → stop retrying.
3. **A way out.** `OutboxModal` gained a per-row Discard and a "Clear all queued changes", both
   behind the app's one confirm dialog, and marks a genuinely-undeliverable write "Couldn't sync"
   so the stuck one is identifiable instead of a mystery.

**Layer 2 ends retries; it never discards.** The write stays in the cache, stays persisted
(`outboxPersistence` drops only `success`), and stays listed. And because `flushOutbox` re-executes
*every* errored outbox mutation on the next reconnect/visibility/login in `byEnqueueOrder`, a
dependency that later succeeds — a 401 followed by a re-login, say — takes its dependents with it in
the same pass. Nothing that could have succeeded is lost; it simply stops holding the queue hostage.

## Two things this turned up on the way

**`App.jsx` loaded the id maps concurrently with the outbox restore.** The comment said *"Both id
maps load first"*; the code was one `Promise.all([loadExerciseIdMap(), loadSetIdMap(),
restoreOutbox(...)])`. A restored dependent could therefore reach the resolver before its mapping
came off disk. That was survivable **only** because an unresolved temp id retried forever and the
map won the race on a later attempt — precisely the behaviour layer 2 removes. A create that already
succeeded is absent from the cache by definition (successes are never persisted), so losing that
race would now fail a write with a perfectly good mapping sitting in IndexedDB. The two are
sequential now; the race is gone rather than papered over by retries.

**`isUnsyncedWrite` and `shouldRetryWrite` disagreed at 408 and 429.** `isUnsyncedWrite` used a bare
`400 <= status < 500` check, so it called those two "already reached the server" while
`shouldRetryWrite` was still retrying them — meaning the logout guard would have discarded such a
write with no warning. Unreachable in practice (they keep retrying and so never settle into
`error`), but the existing "agrees on where the 4xx boundary sits" test sampled 399/400/499/500 and
could not see it. Both now go through `RETRYABLE_4XX`, and the test samples 408/429.

## Rules this leaves behind

- **A durable write may retry forever, but only while retrying can still change the outcome.**
  Waiting on a dependency that can still run: retry. Waiting on one that cannot: stop. The
  distinction is a local question about the mutation cache, never a network one.
- **"Stop retrying" and "discard" are different acts, and only the first is ever automatic.** A
  write leaves the outbox by succeeding, or by an explicit human action — never because it failed.
- **A degraded backend must never be readable as "this write is bad."** 5xx, 502/503/504, aborted
  timeouts and bare rejected fetches all still retry forever, and none of them can produce the
  "Couldn't sync" badge — under those conditions a write never leaves `pending` at all. 401 is
  excluded too: a forced sign-out preserves the outbox and replays it after the next login.
- **Any new dependent write needs an answer to "what if its dependency never lands?"** The pattern
  to copy is `dependencyIsGone` in `queryClient.js`.

## Guards

| Guard | What it pins |
|---|---|
| `lib/outboxNeverWedges.test.js` | A dead write does not block the writes behind it; the queue keeps draining past it, in order. **Verified non-vacuous** — without the `terminal` clause the test hangs and times out, which *is* the bug |
| same file | 500/502/503/504/408/429/abort/rejected-fetch all keep retrying at any attempt count, are never badged dead, and stay counted as unsynced |
| `lib/offlineSetEdits.test.js` | Deleting an unsynced set takes its queued edit with it, and leaves a different set's edit alone |
| `lib/queryClient.test.js` | The three dependency verdicts (still queued → retry; gone → terminal; dependency terminally failed → terminal); `EDIT_SET` 404-as-done; the two predicates agreeing at 408/429 |
| `components/shared/OutboxModal.test.jsx` | Discard on every row; Clear all; the badge appears only for a genuinely dead write |
| `components/shared/OfflineBanner.test.jsx` | The confirm fires before anything is discarded, and clears both the live cache and the persisted copy |
| `e2e/tests/offline-active-loop.spec.ts` | The reported flow end to end, asserting that a set logged **after** reconnecting still reaches the server |
