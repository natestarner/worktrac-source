# 2026-09-23 — Removing an exercise mid-save deleted nothing

**Symptom (as reported):** lower's `e2e-tests` job went red on three deploys (`6fc5ce4`,
`fa37e08`, `510c51c`), each time on the same assertion in `parity-session-recap.spec.ts` ("reports
nothing once every logged set has been removed"). After deleting every set in a workout, the
End-workout dialog still showed a set count. It failed on all three attempts within a run, and
passed on other deploys a few minutes later.

It looked like a flaky spec. It was the app: **"Remove" on the Log tab could report success and
delete nothing**, and the recap was the first thing to tell the truth about it.

## What actually happened

Read from the failing attempt's Playwright trace (network log plus DOM snapshots):

| Wall clock | What happened |
|---|---|
| 46.268 | Set 2's `POST /live-sets` sent. Returned 725 ms later |
| ~46.36 | "← All exercises" |
| 46.494 | `history` refetch sent (the one that would include set 1). Returned ~430 ms later |
| ~46.55 | Remove tapped. The confirm read **"The 1 set you logged…"**, with two logged |
| ~46.64 | Delete confirmed |
| — | **No `listSessionSets`, no `DELETE` was ever sent** |
| ~46.99 | Set 2's create landed on the server |
| end | Recap: "1 exercise · 2 sets", which was the server's truth |

Two independent defects, both needed to lose both sets:

1. **Cancelling a create that is already on the wire does nothing server-side.** Set 2 was an
   optimistic row, so `handleRemove` called `cancelQueuedWritesForSet`, which removes the mutation
   from the cache. The request had already been sent. TanStack has no way to abort it, so it
   landed anyway, and its `onSettled` still invalidated `history`, bringing the "removed" set
   back.
2. **Remove decided whether to enumerate server rows from the row's own snapshot.** The row is
   built from `history` plus pending creates. Set 1's create had already succeeded, so it had left
   the pending list, and `history` hadn't refetched yet, so it appeared in *neither*. The entry
   looked like "one optimistic set", `optimisticIds.length < entry.sets.length` was false, and
   `listSessionSets` was skipped.

Why it was intermittent, and why only on lower: the window is one request's latency. Locally the
backend answers in single-digit milliseconds, so the spec's taps never land inside it. Lower's
round trips are 300–700 ms and vary run to run. Within a run the timing was stable enough to fail
all three attempts, and a later run could miss the window entirely.

## The fix

- **`deleteQueuedSet`** (`offlineSetEdits.js`) is now the one entry point for deleting an
  optimistic set, used by both `SessionSummary`'s Remove and `ExerciseDetail`'s per-set Delete. It
  cancels the create only when the create **provably never left the device**: idle, or paused
  before its first attempt with no failures, and not restored as possibly-sent. A dead write also
  counts, since the server refused it. Otherwise it queues a `DELETE_SET` **against the create's
  tempId**. The shared serial scope runs it after the create settles, and `requireResolvedSetId`
  resolves the real id, the same way a queued `EDIT_SET` already does.
- **`restoreOutbox` stamps `mayHaveBeenSent`** on a set create persisted mid-attempt or after a
  failure. Both restore paths otherwise start it over with a fresh `failureCount` (re-dispatch) or
  a forced `isPaused` (signed out), which would make it look never-sent.
- **`isDeleteQueuedFor`** (`queryClient.js`) hides a create with a delete queued against it from
  every reader of pending creates: `useSessionEntries`, `ExerciseDetail`'s pending rows, and
  `LOG_SET`'s own seed of the confirmed row. `useSessionRecap` matches deletes by tempId too.
- **`mayHaveServerRows`** (`SessionSummary.jsx`) gates the `listSessionSets` enumeration, and the
  offline wrap, on local evidence of server rows: a synced set in the row, **or** a succeeded
  `LOG_SET` for this exercise into this session that `history` may not reflect yet.

## How it was proven

- A new e2e, `removing an exercise mid-save deletes every set it had, synced or in flight`,
  holds set 2's create and the `history` refetch open with `delayNetwork`, so every run lands in
  the window lower only hit by chance. It **asserts against the server directly**, after the held
  create lands and the outbox drains. With either half of the fix disabled it fails with the Bench
  set still on the server. Both were checked separately.
- The first version of that spec asserted on the recap instead, and **passed with the tempId half
  disabled**. Before the held create lands, the bug is invisible (the set isn't on the server
  *yet*), and `toBeVisible` polling happily caught the correct transient. A read that can happen
  before the bad write lands cannot detect it.
- Unit tests pin each piece (`offlineSetEdits`, `SessionSummary`, `useSessionEntries`,
  `useSessionRecap`, `outboxPersistence`, `queryClient`). Each was run red with its guard reverted.

## Takeaways

- **"Cancel" is only a delete while the request is still on the device.** Once it may have been
  sent (in flight, failed once, or restored), removing the mutation from the cache just stops you
  watching it land.
- **Don't derive "what exists on the server" from a view that lags it.** The row is built from a
  query that is one refetch behind a set that just synced, so there is a window where a synced set
  appears in no source the row reads. Ask local evidence that doesn't lag (the succeeded mutation)
  or ask the server.
- **A spec that fails on every attempt within a run but passes on the next run is a timing window,
  not flakiness.** Read the trace before rerunning.
