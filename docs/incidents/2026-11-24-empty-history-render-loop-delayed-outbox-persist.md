# A fresh empty History list per render looped the Log screen and delayed saving an offline set

**Found:** 2026-11-24, while building first-set weight (`load_type`). **Shipped:** with that change.
**Area:** frontend state / offline persistence.

## Symptom

`offline-durability.spec.ts`'s "create-then-log-set survives a reload mid-lie-fi" (PWA build)
started failing about 6 runs in 8. A set logged offline on a just-created exercise showed
"2 changes waiting to sync", and after an immediate reload the outbox held only the exercise
create. The set was gone.

## What it was

Not storage contention, and not the outbox persister. Measured in the page:

- The set reached IndexedDB 200ms to 7s after the banner showed, sometimes not before the reload.
- In the same window the Log screen rendered **several thousand times** with identical values.
- `ExerciseDetail`'s prefill-recording effect ran on nearly every render (281 effects in 288
  renders), and each run wrote the draft, which rendered again.
- The dependency that changed each time was `history` from `useHistory`.

`useHistory` returned `query.data ?? []`. On a device that has never held this person's History,
offline, the fetch is **paused**: nothing is held and `isLoading` is false, so the readers treat
the empty list as the answer. A new `[]` each render recomputed `derivedSummary`, then `summary`,
then the effect, which called `setDraft`, which re-rendered. A few hundred renders a second
starved the page, so the outbox's per-change `set()` landed late or not at all before the reload.

It is on `main` too. It needs a non-null `prefill` that the person does not own, which, offline
with no History held, is any exercise with a set logged today. The old spec tapped Log set
straight after the create and reloaded quickly enough that it mostly won anyway. The first-set
change added a wait for the summary card before the tap, which widened the window.

## Fix

`useHistory` hands back one frozen `NO_HISTORY` array. Renders after the set went from thousands
to 12, the set is on disk ~6ms after the banner, and the spec passed 8 of 8 with an immediate
reload. `hooks/useHistory.test.jsx` pins the identity and fails against `?? []`.

## Takeaway

**A hook that defaults missing data must default to a stable value.** `?? []` / `?? {}` in a
hook's return is a new dependency every render for every `useMemo` and effect downstream. It is
harmless until something downstream writes state, and then it is a render loop that only shows
under the exact cache state that leaves the data missing (here: never fetched, and offline).

**"The write is persisted on every change, with no throttle" assumes the page gets to run.** A
render storm is a degraded condition the outbox cannot see.
