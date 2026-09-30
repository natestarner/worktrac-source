# 2026-09-30 — A queued set was drawn above an earlier set whose save landed late

## Symptom

`parity-record-badges.spec.ts`'s "records are badged on the sets that took them, in the session
in progress" failed on lower in every degraded mode: lie-fi in 15 of 67 deploy runs, hard-offline
in 9, pinned-offline in 4. The failure was the same each time. Three set rows were on screen, and
one record badge where the spec expected two. It usually passed on retry, so most runs still
finished green.

A failure snapshot on 2026-09-25 showed what a person would see. The set logged offline (185×8)
was labelled "Set 1" and drawn *above* the baseline set (135×5), even though it was logged later.
It took both records, and the baseline showed none.

## Why it took so long to find

- A retry-pass is invisible in a green run's summary. `gh run download -n` returns only the
  last attempt of a rerun. So "clean in the last N runs" checks missed most occurrences.
- In `results.json`, parity specs are filed under `support/parity.ts`, not under their own spec
  file. A scan filtering on the spec's file name found nothing, which looked like a clean record.
- It never reproduces on a local stack, where the baseline set's save finishes long before the
  test switches connectivity.

## Root cause

`ExerciseDetail`'s `displaySets` was `[...pendingBeforeSession, ...sessionSets]`. That assumed
every still-queued set is earlier than every synced one. The failing sequence shows how that
breaks:

1. The workout's first set (135×5) is saved online, and its request is still in flight.
2. The spec enters the degraded mode. A request already on the wire can still complete under
   lie-fi and the pin, and sometimes under `setOffline`.
3. 185×8 is logged. There is no session id yet, so `onMutate` writes no `sessionSets` row, and the
   set can only appear as a `pendingBeforeSession` row.
4. The first set's response lands. `LOG_SET`'s `onSettled` seeds it into `sessionSets` and
   promotes the live session.
5. Prepending puts 185×8 above 135×5. Record badges fold in display order, so 185×8 takes both
   records.

`log-screen.md` already listed the prepend as "known and pre-existing" for a mid-drain
reordering. It hadn't been connected to this spec.

## Fix

`mergeSetsByTime` merges pending rows into `sessionSets` by time. A pending row is timed by its
`clientLoggedAt`, and a synced row by its `createdAt`, which the server takes from that same
`clientLoggedAt` for a live set. Both times come from one device clock. A synced row with no time
(the optimistic row `onMutate` writes) is never taken ahead of a pending one. So wherever a time
is missing, the order is exactly what it was before. The mid-drain reordering is fixed by the
same change.

Pinned by `ExerciseDetail.test.jsx` → "places a queued set AFTER a synced set that was logged
before it", which fails against the old prepend.

## Takeaway

Anything assembled from two sources, a queue and a server cache, must be ordered by the data's
own time, never by which source it came from. A row can move from one source to the other at
any moment.
