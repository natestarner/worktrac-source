# An ended workout came back to life on lower (2026-08-08)

- **Symptom.** On lower only, opening an exercise offline shortly after ending a workout showed
  that finished session's sets under **"This session"**, mixed in with newly logged offline ones.
  Caught not by a targeted test but as a stray third row in the Playwright report for an unrelated
  spec:

  ```
  Set 3   45 lb × 8    ← logged offline
  Set 2   55 lb × 8 PR ← logged offline
  Set 1   45 lb × 8    ← the PREVIOUS, already-ended session's set
  ```

  It never reproduced locally, which is the tell: the service worker is disabled in `vite dev`
  and Vitest.

- **Root cause.** Two independently reasonable behaviours combining, the same shape as
  `2026-07-28-liefi-cached-sections-blank.md`:

  1. `EndWorkoutConfirmModal` clears the `liveSession` query entry synchronously, but the
     **persister's write is throttled** — `persistQueryClient`'s 1s default, and `persistOptions`
     sets no `throttleTime`. For up to a second, disk still says the session is live.
  2. `swUpdate.js`'s `tryForceUpdate` **silently reloads** on ordinary navigation whenever a new
     service-worker build is available — which is always true just after a deploy, i.e. exactly
     when the lower e2e suite runs.

  A reload inside that window hydrates the pre-end snapshot. The restored session carries a
  **real id**, unlike the deliberate `{ id: null }` offline placeholder that `contextSessionId` is
  built to ignore — so `contextSessionId` picks it up, the `sessionSets` query (`enabled:
  !!contextSessionId`) resolves against the finished session, and its sets are still sitting in
  that cache from when it genuinely was live. Online the 10s `staleTime` corrects this on the next
  refetch; offline nothing can, so it stands for the whole offline stretch.

- **Fix.** `lib/endedSessions.js` — a **synchronous localStorage marker** written *before* the
  cache clear, consulted by `useLiveSession`, which reports `null` for a session this device has
  already ended. localStorage specifically because the write cannot be beaten by a reload; the
  same reasoning behind `offlineMode.js`'s manual pin and `outboxPersistence.js`'s account
  pointer. Never cleared and needs no clearing: it suppresses exactly one id, and session ids are
  never reused.

  Rejected alternatives: lowering `throttleTime` (narrows the window, never closes it, and costs
  an IndexedDB write per cache change); `persistQueryClientSave` on end (still async, still
  raceable); not persisting `liveSession` at all (offline cache-warming deliberately wants it).

- **Takeaway.** The query cache alone cannot carry *"this thing is over"*. A throttled persist
  plus a reload you can't predict means any entry whose staleness would be **actively wrong**
  rather than merely old needs a synchronous durable marker beside it. Recorded as an invariant in
  `.claude/rules/offline-internals.md`.

- **Also worth remembering:** the reproduction that mattered was a `dehydrate`/`hydrate` round trip
  against the app's **real** `persistOptions` (`.claude/rules/frontend-tests.md` already recommends
  this). Reasoning about the sequence by inspection produced two confident, wrong theories first.
