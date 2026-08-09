# A restored cache entry looked "freshly checked", so nothing ever refetched it

**Date:** 2026-08-08
**Area:** Frontend — persisted query cache, offline cache warming
**Symptom:** A routine created seconds before a page reload was gone after the reload, and stayed
gone. Surfaced as `reload-persistence.spec.ts` failing on lower ("an active routine survives a page
reload") while passing every local run. Issue #146.

## What happened

Two facts about the persisted query cache collide:

1. **The persister is throttled to one write per second** (`persistOptions`, `throttleTime: 1000`),
   so the copy on disk can lag what's in memory.
2. **`dataUpdatedAt` survives the round trip.** A restored entry reports the time it was originally
   fetched — during the *previous* page's lifetime.

So a reload landing inside that one-second window restores a pre-change snapshot that still
*claims* to be seconds old. Every freshness check then waves it through:

- `offlineCacheWarm`'s `WARM_STALE_TIME` (30s) — skips it,
- the queries' own global `staleTime` (60s) — skips it,
- `refetchOnWindowFocus` — only refires *stale* queries, so it skips it too,
- leaving only `WARM_INTERVAL_MS`, the **5-minute** warm tick.

The data was wrong and the app never asked again.

## How it was actually diagnosed

The page snapshot alone was ambiguous — it showed the "create a routine" empty state, which is
equally consistent with a slow backend or a failed request. **The Playwright trace settled it.**
Its network log for the failing run:

```
13:49:54.103  GET /routines    <- login warm: no routines yet
13:49:55.156  GET /routines    <- routine created; cache now correct
13:49:55.5    reload           <- 0.35s later, inside the 1s persist window
13:49:55.8    GET /auth/me     <- app back up
13:49:56.03   GET .../summary
              ... 15 seconds of complete network silence ...
```

The trace spans 19.7s (matching the 19.8s test), so it is not truncated. **No `/routines` request
was ever made after the reload** — and neither were any of the other warmed keys, because the boot
warm evaluated all of them as fresh. Not a slow backend, not a failed request: no request at all.
That distinction is what made the trace worth opening; "no request" and "slow request" look
identical from a screenshot but have opposite fixes.

It never reproduced locally because whether the reload beats the throttle is a coin flip on
sub-second timing, and lower's tipped it. It went from clean, to flaky, to consistently red as
unrelated changes shifted the suite's timing.

## Fix

`offlineCacheWarm.warmOfflineCache` takes `{ afterRestore }`, passed **only** by the boot warm in
`useOfflineCacheWarming` (the one that fires once `isRestoring` clears). It drops `staleTime` to 0
for keys marked `refreshAfterRestore`, so they refetch instead of being skipped. Later warms
(reconnect, tab focus, the 5-minute tick) are unchanged — by then the cache is what this page
session fetched, and ordinary staleness is correct.

**`refreshAfterRestore` is opt-in per key, and the exclusions are the load-bearing part.** Forcing
is only safe where the server wholly owns the data:

| Key | Forced | Why |
|---|---|---|
| `routines` | ✅ | routine CRUD is online-gated, so the cache can't hold an unsent routine |
| `history`, `prs` | ✅ | no optimistic writer; invalidation-driven only |
| `exercises`, `personExercises` | ❌ | hold a queued custom exercise **and** an offline-toggled favourite (plus that exercise's tags and note — all three ride on `PersonExerciseDto`) |
| `liveSession` | ❌ | optimistically nulled by `EndWorkoutConfirmModal` on end-workout |

Rejected alternatives, both of which would have destroyed unsynced work:

- **Invalidate everything after hydrate.** Refetches `exercises`/`personExercises`, deleting a
  queued custom exercise from the picker and reverting an offline favourite mid-flight.
- **`refetchOnMount: 'always'` per query.** Same exposure, and it also refetches on every ordinary
  mount, killing the deliberate "return to a tab and it paints instantly, no Refreshing pill" UX
  that `staleTime: 60s` exists to provide.

Note this is a *different* shape from
`2026-08-08-ended-workout-resurrected-by-persisted-cache.md`, which also began with the throttled
persist. There the restored entry was **actively wrong** ("this workout is still live") and needed
a synchronous durable marker beside the cache. Here it is merely **out of date**, so re-asking the
server is enough — no new storage, no new source of truth.

## Rules this produced

- **A restored entry's `dataUpdatedAt` describes the previous page session, not this one.** Fresh
  is not the same as correct. Recorded in `.claude/rules/offline-internals.md`.
- **Before marking a key `refreshAfterRestore`, ask whether it can ever hold state that hasn't
  reached the server.** If yes, refetching destroys it. This is why the list is opt-in rather than
  a blanket policy.
- **A test asserting "these keys were NOT refetched" can pass vacuously.** The exclusion guard was
  verified by temporarily flagging `personExercises` and confirming the test fails.
- **For a lower-only e2e failure, read the trace's network log before theorising.** "No request
  was made" and "the request was slow" are indistinguishable in a screenshot and have opposite
  fixes.
