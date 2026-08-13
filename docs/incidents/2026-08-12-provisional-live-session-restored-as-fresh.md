# A live session the client invented was restored as if the server had said it

**Date:** 2026-08-12
**Area:** Frontend — persisted query cache, log screen, offline placeholders
**Symptom:** Log a set while degraded, reconnect, let the outbox drain, reload — the set is gone
from "This session", even though it reached the server. Found by the parity harness
(`parity-active-loop.spec.ts`) on its first run and recorded as a `fixmeModes` entry rather than
patched.

## What happened

`logSetMutation.onMutate` seeds a **provisional live session** so the session banner and green dot
light up the instant a set is logged, before any session id exists:

```js
queryClient.setQueryData(queryKeys.liveSession(personId), (prev) => prev ?? { id: null, startedAt });
```

That entry is a client-side invention. `setQueryData` nonetheless stamps it with
`dataUpdatedAt = Date.now()`, and `shouldDehydrateQuery` persists anything holding data — so it goes
to disk looking exactly like a value the server just handed us.

After a reload, that timestamp is a lie, and every freshness check in the app believes it:

- `useLiveSession`'s own `staleTime` (10s) — skips it,
- the global `staleTime` (60s) — skips it,
- `offlineCacheWarm`'s `WARM_STALE_TIME` (30s) — skips it,
- `refreshAfterRestore` — deliberately excludes `liveSession`, because `EndWorkoutConfirmModal`
  optimistically nulls it.

So nothing asks the server for the real session id. `contextSessionId` stays `null`, the
`sessionSets` query is `enabled: !!contextSessionId` and never runs, and the person's own set list is
simply absent — while the sets themselves are safely on the server.

This is the mirror image of `2026-08-08-ended-workout-resurrected-by-persisted-cache.md`. There a
restored entry carried a **real** id for a session that was over. Here it carries **no** id for a
session that has since become real. Same key, same persister, opposite direction — and note that the
2026-08-08 write-up already stated the rule that would have caught this: *"any other cache entry
whose staleness would be actively wrong rather than merely old needs the same treatment."* A
provisional entry is the strongest form of that: it isn't stale, it was never true.

## How it was actually diagnosed

The recorded reproduction pointed at a mechanism that does not exist ("only the two modes where the
session never had a server-issued id during the write fail" — hard-offline has no server id during
the write either, and passed). Instrumenting it was what settled it. Two probes, both cheap:

1. **Count `GET /api/people/{id}/sessions/live` after the reload.** The 2026-08-08 lesson again: "no
   request was made" and "the request was slow" look identical in a screenshot and have opposite
   fixes. Result in the failing mode: **zero**. Nothing even asked.
2. **Read the "Last time" card.** `StatsService#getLastSession` only folds today's session into
   `lastSession` when `excludeSessionId` is null, so the card is a direct readout of
   `contextSessionId`. Failing mode: `LAST TIME · TODAY 0lb×8`. Passing modes: `LAST TIME · No sets
   yet`. That one string distinguishes "the id is missing" from every other explanation.

## Two things the original note got wrong

**The per-mode pattern was not a per-mode divergence.** All three degraded modes are exposed;
hard-offline was escaping on timing. The bug needs the placeholder to have actually reached disk, and
the persister is throttled to 1s. Lie-fi's retry backoff makes its runs take seconds, so its
placeholder was always written; hard-offline finished in under a second, so its reload restored a
snapshot with no `liveSession` entry at all — and a query with no cached data just fetches, which
looks like correct behaviour. Adding a 1.2s in-mode wait makes all three reproduce. Reverting the fix
now gives **3 failed, 1 passed**.

Online is the only structurally safe mode: there the placeholder lives ~50ms before `onSuccess`'s
`refetchLiveSession()` replaces it with the real session, so it is never what gets persisted.

**Three of the four modes were passing that spec vacuously.** `waitForOutboxDrain` gated on the
banner's "N changes waiting to sync", and `useOutboxCount` deliberately stops counting a write once
it is a plain in-flight first attempt (pending, not paused, `failureCount` 0) so a fast online write
doesn't flash the banner. That exclusion also fires the instant `resumePausedMutations()` un-pauses a
queued write — so the gate opened while the write was still in flight, the reload landed with it
still in the durable outbox, and the row that appeared afterwards came from `restoreOutbox`'s replay
rather than from the server. Measured at the gate: `Saving…` visible, 1 outbox entry, in three of
four modes. Only lie-fi — whose write has `failureCount > 0` and so stays counted until it genuinely
succeeds — was testing the thing the spec claimed to test.

## Fix

`useLiveSession`'s `staleTime` becomes a function: a session with no server id can never be fresh.

```js
staleTime: (q) => (q.state.data && q.state.data.id == null ? 0 : 10 * 1000),
```

Zero means "always revalidate". Online it resolves to the real id on the next tick; offline the
refetch simply pauses and the placeholder keeps rendering, so the "Session in progress" banner and
the person-pill dot are unaffected by design — suppressing the entry (the shape the ended-session
guard uses) would have traded this bug for a worse one. `staleTime` is resolved per `Query`, so only
the person actually holding a provisional session refetches.

`waitForOutboxDrain` additionally waits for the per-row `Saving…` state to clear — the
first-in-flight-attempt signal the count deliberately omits. **`useOutboxCount` itself is unchanged**:
its exclusion is correct product behaviour, and the gap belonged to the test helper.

Rejected: adding `liveSession` to `refreshAfterRestore`. That list is opt-in precisely because the
key can hold state that hasn't reached the server, and forcing a refetch would destroy the
end-workout optimistic null.

## Rules this produced

- **A cache entry the client invented has no honest `dataUpdatedAt` at all.** "Fresh" and "correct"
  were already known to be different; this adds a third case where the timestamp describes when *we
  made the value up*. Recorded in `.claude/rules/offline-internals.md`.
- **A drain gate built on the outbox count is not a "the write reached the server" gate.** Recorded
  at `waitForOutboxDrain` itself.
- **A `fixmeModes` entry is a hypothesis, not a diagnosis.** Recording the divergence instead of
  blind-patching was right — the fix landed in a file that has produced most of this directory. But
  the recorded *shape* (which modes, and why) was wrong in both of its claims, and one instrumented
  run was enough to show it. Confirm a reproduction measures what it says before reasoning from its
  pattern.
