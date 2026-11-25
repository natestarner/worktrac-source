# 2026-11-24 — Sets logged on a just-created exercise vanished from its screen after reconnecting

## Symptom

Found during the new-user walk-through for iOS 1.4, and reproduced twice by hand:

1. Offline, create your own exercise.
2. Log two sets on it (50×10, 60×10).
3. Reconnect.

The exercise screen's set list showed only "Set 1". It stayed that way after a reload. The server
had both sets: History showed both, and so did a fresh device. The Best card on the same screen
showed 60×10, so the data was on the device too. A person would think a set had vanished and
could log it again, making a duplicate.

The same steps with a library exercise were correct, and so was logging online and then going
offline.

## Root cause

Measured with a network trace and the persisted query cache, not inferred.

A custom exercise created offline has a temporary id (`temp-exercise-<uuid>`) until its create
reaches the server. Every set logged on it before then is queued with that temp id in its
variables, and in its mutation key (`['logSet', personId, <temp id>]`). On reconnect the outbox
drains in order: the create lands, `exerciseIdMap` records temp → real, and `LogTab` moves the
screen to the real id. Then the sets land, one at a time.

Two things still named the temp id after the screen had moved on.

**1. The set-saved handlers refreshed lists nothing reads.** `LOG_SET`'s `onSettled` seeded and
invalidated `session-sets(<session>, <temp id>)` and `exercise-summary(…, <temp id>, …)`.
`reconcileSetChange` (edit/delete) and `SAVE_NOTE` did the same. The screen reads
`session-sets(<session>, <real id>)`. The trace:

| ms | |
|---|---|
| 1398 | set 1 lands; the screen gets the session id and fetches `session-sets(1, 214)` |
| 1443 | that fetch returns `[set 1]` (set 2 is still on the wire) |
| 1463 | set 2 lands; its handler seeds and invalidates `session-sets(1, "temp-exercise-…")` |

The persisted cache afterwards held both keys: `[1, "temp-…"]` with set 1, and `[1, 214]` with
only set 1. The real key was fresh for its 60s `staleTime` and persisted, so a reload inside that
minute restored it as fresh. It corrected itself only once it went stale and something refetched
it.

**2. The screen stopped drawing still-queued sets at the remap.** `ExerciseDetail` read queued
sets (`unsyncedLogSets`, the source of `pendingBeforeSession`) and queued notes
(`pendingLiveNote`) by mutation key, and the key carried the exercise's id at the time of
dispatch: the temp one. From the moment the screen moved to the real id until each set landed,
those sets were drawn nowhere. With the set saves held 4s after the create landed, the screen
showed **zero** sets for the whole 4s. On lower (~750ms a write) that is a visible blink. If the
connection dropped again right after the create landed, they stayed hidden for the whole outage.

A library exercise never has a temp id, so both keys always agreed. That is why only a
just-created exercise showed it, and why it needed the create and its sets to land separately.
That happens in every degraded mode, and online whenever the create is still on the wire when a
set is logged.

## Fix

Both halves resolve the exercise id through `resolveExerciseId` (`lib/exerciseIdMap.js`).

- `LOG_SET`'s `onSettled`, `reconcileSetChange` and `SAVE_NOTE`'s `onSettled` key every seed and
  invalidation on the resolved id. The mapping always exists by then: the create and its
  dependents share the one serial outbox scope, and `mutationFn` refuses to send an unresolved
  id, so a set that succeeded had a mapped exercise.
- `ExerciseDetail`'s two queued-write readers filter on `['logSet' | 'saveNote', personId]` plus a
  predicate comparing resolved ids (`isForThisExercise`). `useMutationState` re-reads its filters
  on every render, so a module-level id map is fine there.

For an exercise with no temp past, resolving is the identity, so library exercises take exactly
the path they took before. That is the property that makes this safe in an area that has seesawed:
nothing about the common case changes.

## Tests

- `queryClient.test.js` → "writes against a just-created exercise reconcile the REAL exercise id's
  keys": the set lands in the list the screen reads, the summary is carried under the real id, an
  edit and a note refresh the real keys, a still-temp failure touches no real key, and a library
  id keys exactly as before. Four fail on the old code; the other two pin unchanged behaviour.
- `ExerciseDetail.test.jsx` → "keeps drawing a set queued under the temp id once the screen has
  moved to the real id" (red on the old code), and "does not draw a set queued under a temp id
  that is not this exercise" (resolving must not widen the match).
- `e2e/tests/parity-new-exercise-sets-reconnect.spec.ts`, all four modes at local speed and with
  set saves at lower's ~750ms. Per frame through the reconnect: never no sets, never a duplicate
  or stray value, and both once settled; then both again after a reload. Red in all six degraded
  runs on the old code. Removing either half of the fix alone fails it (5 and 6 of 8).

## Found alongside, not fixed here

**A one-frame dip to a single row when a queued set's save lands, for every exercise.** When a
queued set lands, it leaves `ExerciseDetail`'s queued list (its own `useMutationState`) a render
before the new session id reaches the screen through `LogTab`'s live-session query, so for that
render it is in neither list. Measured with a library exercise on the code from before this fix:
10 of 12 runs with the page's CPU slowed 4x, and about 1 in 75 under ordinary parallel test load.
It lasts one render, roughly 250ms on a 4x-slowed CPU. It is pre-existing and separate, so the new
spec deliberately tolerates a single-row frame (and says why) rather than assert it. It is a
follow-up.

**A reload within a second of creating an exercise offline drops it from the screen until the
connection returns.** Found when this incident's reload spec flaked once in three on its first
lower deploy (the two sets were logged 0.9s after the create). The optimistic row lives in the
query cache, whose persist is throttled to once a second (`offline-internals.md`), so a reload
inside that second boots without it: an empty picker, and the selected temp id resolves to
nothing. The queued create and sets are in the outbox (its own key, written on every change), so
nothing is lost and the screen recovers when the create lands. Reproduced 8 of 8 locally by
reloading right after an offline create, against 0 of 8 once the cache persist is awaited. The
spec now awaits it, as `waitForQueryCachePersist` exists to do. The app-side behaviour is
pre-existing and is a follow-up. A real reload that fast needs `swUpdate.js`'s forced reload
landing on a navigation in that same second.

## Item 15, decided against on evidence

The same investigation looked at the two requests the screen sends while the id is still temp
(the summary and custom fields, both a 400). The proposed fix was to skip them and show the summary
derived from History, as offline does. A throwaway experiment recorded the screen frame by frame
through a create, before and after:

- **Online, it made things worse:** the summary cards showed, dropped back to a loading
  placeholder when the real id arrived, then showed again; the Reps box went 8 → blank → 8. At
  lower's speed the placeholder lasted about 0.8s.
- **Lie-fi, better:** no 3s placeholder while the 400s retry.
- **Offline, identical.**

Two invisible 400s are not worth a visible blink in the weight/reps area, so it was not done.

## Takeaway

**A key built from an id that can change must be built from the id the screen reads now, not the
one captured at dispatch.** The 2026-07-30 follow-up learned this for the session id; this is the
exercise id. Any new write that targets a just-created exercise, and any new reader of queued
writes, must go through `resolveExerciseId`.
