# Offline Mode Notes

- **Three connectivity states, not two:** fully online; online but the backend is
  unreachable/erroring while `navigator.onLine` still reports `true` ("lie-fi" — captive-portal
  wifi, a dead upstream, flaky cellular); and offline (auto hard-offline, or a user-elected
  manual pin). Each has different UI and different write semantics — see the table below.
- **Connectivity detection layers:**
  - `useOnlineStatus` (`frontend/src/hooks/useOnlineStatus.js`) reads TanStack's `onlineManager`
    — the single source of truth every other piece of offline UI/gating reads. Reflects hard
    offline (`navigator.onLine`) or the manual pin (see below); never lie-fi.
  - **Manual pin** (`frontend/src/lib/offlineMode.js`): `pinOffline()`/`unpinOffline()` drive
    `onlineManager` directly (device-global, `localStorage` key `worktrac-offline-pinned`,
    re-applied at module load so it survives reload before the first query fires). Entered via
    the "Go offline" button on `ConnectionTroubleBanner`; only ever exited by the user (the
    `OfflineBanner`'s "Go back online" or `OfflineRecoveryPrompt`'s "Resume syncing" — both
    gated on `probeReachability()` actually succeeding first). Never auto-unpins on its own,
    even if the connection flickers back — a pin the user set on purpose stays until they lift
    it.
  - **Lie-fi detection** (`frontend/src/lib/reachabilityMonitor.js`): every request's outcome in
    `api/client.js` feeds a consecutive-failure counter; a real completed response (even a
    4xx/5xx — the server answered) resets it to zero, only a genuine network-level failure
    (rejected fetch) counts. After 3 in a row, `ConnectionTroubleBanner` suggests "Go offline".
    This is the *only* signal that can't be driven by Playwright's `context.setOffline()` — it
    needs request-level fault injection (`e2e/tests/support/faults.ts`'s `failNetwork`, not
    `failWithStatus`, which fulfills a real response and therefore never trips this).
- **The durable write outbox** (`frontend/src/lib/outboxPersistence.js` +
  `frontend/src/lib/queryClient.js`): every offline-capable write shares one TanStack mutation
  scope (`OUTBOX_SCOPE_ID`) so queued writes replay strictly serially, in enqueue order, on
  reconnect (an exercise-create replays before a set logged against its temp id, and an edit
  queued against a still-syncing set replays after the create it depends on — see the two
  Resolved Incidents below for the mechanism this guarantee depends on). Persisted to
  its own IndexedDB key (`worktrac-outbox:<accountId>`) — deliberately separate from the query
  cache's persister, so neither the query cache's 24h `maxAge` nor an app-update `buster` bump
  can ever silently drop a queued write. Every write carries a client-generated idempotency key
  so a replay (or a retried/duplicated dispatch) can't double-insert; delete-set treats a replay
  404 as success. `flushOutbox()` (resume paused + re-dispatch terminal-errored) runs on
  reconnect, on regaining tab visibility while online, after login, and from the "Go back
  online"/"Resume syncing" buttons.
  - **Retries forever on a transient failure** (`shouldRetryWrite` in `queryClient.js`): a 5xx,
    timeout, or statusless network error backs off (capped at 30s) but never gives up — a
    connectivity problem alone can never be the reason a queued write is lost or silently stops
    trying. Only a definitive 4xx (the server's real answer) stops retrying, since a write that
    can never succeed would otherwise permanently head-of-line-block every write queued behind it
    in the shared serial scope. A dependent write (log-set/note/favorite) that still resolves to
    an unmapped temp exercise id throws a status-less (therefore retryable) error instead of
    dispatching a value the backend can't parse — see the Resolved Incident below.
  - **Gated on an authenticated session:** `flushOutbox()` and `restoreOutbox()` (boot) no-op /
    hydrate everything as paused when there is no current auth token, rather than firing a queued
    write with no `Authorization` header — that tokenless request would 401, and a 401 can itself
    tear down a session that a moment later *does* have a valid token. This is what makes a
    forced-401 logout preserve the outbox safely instead of risking a login loop on the next
    sign-in.
- **Mutation coverage — active-loop (durable, offline-capable) vs. Tier-3 (online-gated):**
  | Feature | Offline? |
  |---|---|
  | Log/edit/delete a set, session start/end, session note, favorite/unfavorite, create a custom exercise | ✅ durable outbox |
  | Add person, routine CRUD, tags, default unit, rest-timer preference, exercise rename/tags/custom fields, log a past workout, export, delete account, edit person | ❌ gated — needs a connection |

  Tier-3 actions are gated because some (e.g. `createPastSession`) are **not idempotent** and
  would duplicate on replay, and others are management actions where "queue it silently" would
  be surprising. Gating is `useRequireOnline` (wraps a handler; shows a calm "needs a
  connection" toast and disables the control) or `OfflineDisabledWrap` (greys out/disables an
  entry-point button with a `title` tooltip) — both read `useOnlineStatus` only, so they do
  **not** react to lie-fi (mode 2); a Tier-3 write attempted during lie-fi is simply attempted
  and fails/succeeds for real, same as fully online.
- **Per-row UI state:** "Saving…" is reserved for a write's very first in-flight attempt.
  Once it's paused (offline), has failed and is retrying, or is sitting in a transient error, it
  gets Edit/Delete controls immediately — exactly as durable/editable as an already-synced row
  — rather than an indefinite spinner over a request that may never succeed (see
  `ExerciseDetail.jsx`'s `editableTempIds`). The banner's outbox count ("N changes waiting to
  sync") is what signals "not yet synced", not the row itself.
- **Offline cache warming** (`frontend/src/lib/offlineCacheWarm.js` /
  `useOfflineCacheWarming.js`): proactively prefetches every household member's
  logging-essentials (live session, person exercises, routines, history, PRs) in the background
  — not just whichever person/tab is on screen — so a device hand-off mid-outage (a sibling
  grabs the iPad) still renders instead of spinning forever. Deliberately still excludes
  `trendsOverview`/`exerciseTrend` (the analytics fan-out — high cost keyed by exercise × range,
  low value mid-workout) and `ExerciseDetail`'s session-scoped queries (`sessionSets`,
  `customFields`, `sessionExerciseNote` — can't be enumerated without knowing the live/edit
  session id).
  - `exerciseSummary` (Exercise Detail's "Last time"/"Best est. 1RM" card) is likewise not
    prefetched, but for a different reason: `frontend/src/utils/exerciseSummaryFromHistory.js`
    derives it client-side from the already-warmed `history` cache whenever the live query has
    no answer yet (`isPaused` — hard offline/manual pin — or `isError` — lie-fi: the fetch is
    attempted since `navigator.onLine` is true, but the backend is unreachable). Because
    `history` is unpaginated (every session, every set), this produces the *same* answer
    `StatsService#getLastSession`/`#getBest` would, not an approximation. Once stuck, the
    derived value is preferred **over** `summaryQuery.data` too, not just used when data is
    absent — `contextSessionId` collapses to the same `null` cache key both "before this person
    has ever logged anything" and "after their live session just ended," so a stale answer from
    the first of those moments can already be cached under that exact key by the time the
    second one needs it, and a stuck live query can never revalidate it away on its own.
- **A per-session display value needs its own pending-mutation fallback, not just a durable
  write — being queued in the outbox is not the same as being visible.** `contextSessionId`
  (`liveSession?.id || editingSessionId`, in `ExerciseDetail.jsx`) stays `null` for a person's
  *entire* offline/lie-fi stretch, not just before their first set: the placeholder `liveSession`
  seeded by `logSetMutation.onMutate` is deliberately `{ id: null }` so it can never leak into
  `contextSessionId`, and the real id only arrives once the create-session round trip actually
  reaches the server. Any query keyed on that id (`sessionSets`, `sessionExerciseNote`,
  `exerciseSummary`) is `enabled: !!contextSessionId` and so never even runs during that window —
  its write can be durably queued and guaranteed to sync later, while the value it produced stays
  invisible on screen the whole time. Three fallbacks in `ExerciseDetail.jsx` use the same
  technique to close this gap: `pendingBeforeSession` (an unsynced set, read from the log-set
  mutation's own variables via `useMutationState`), `derivedSummary` (the "Last time"/"Best"
  card, derived from the already-warmed `history` cache instead — see below), and
  `pendingLiveNote` (a session note saved before/without a synced session, read from the pending
  `SAVE_NOTE` mutation's own variables the same way `pendingBeforeSession` does). **When adding a
  new per-session display value, ask the same question posed for per-person state above:** would
  it stay blank for a person whose current session hasn't synced yet, even though the underlying
  write is durable and guaranteed to succeed? If yes, it needs one of these two techniques —
  derive it from an already-warmed, session-independent cache (`history`) if one exists, or read
  it straight from the relevant mutation's own variables via `useMutationState` (filtered by
  `mutationKey` plus the relevant person/exercise ids, excluding `status === 'success'` and a
  definitive-4xx failure) — rather than relying on cache invalidation alone, which is a no-op
  while paused offline.
- **Cold boot offline:** `AuthContext` boots authenticated-but-`offline:true` from a saved
  identity snapshot (`localStorage`) when `/me` fails with a network error or 5xx and a token +
  snapshot exist; a real 401 still bounces to `/login`. **No snapshot yet** (a fresh profile, or
  one just cleared) and a transient `/me` failure holds on the loading skeleton and retries with
  capped, doubling backoff (`RECONNECT_RETRY_BASE_MS`/`RECONNECT_RETRY_MAX_MS`) instead of
  signing out — the token may be perfectly valid; the server just hasn't answered yet. Requires the production service worker
  to precache the app shell (`vite-plugin-pwa`, `generateSW`, `registerType:'prompt'`) —
  **disabled in `vite dev`** (no bundle to precache there) and in Vitest. Exercise it locally via
  `npm run build && npm run preview`, or `cd e2e && npm run test:pwa`
  (`playwright.pwa.config.ts`), which builds + previews on port 3000 (needed for local CORS —
  `vite preview`'s proxy forwards the browser's real `Origin` header through, so it can't just
  run on a different port without also reconfiguring `CORS_ALLOWED_ORIGINS`) and runs only
  `offline-durability.spec.ts` (`.spec.ts` files elsewhere are `testIgnore`d from that config,
  and `offline-durability.spec.ts` itself is excluded from the fast default project).
- **Logout data-loss guard** (`frontend/src/components/layout/UserMenu.jsx`): an explicit user
  logout with a non-empty outbox shows an inline warn-and-confirm ("N changes haven't synced yet
  and will be lost") before discarding it — a different household may log in next, so the outbox
  can't just carry over. A forced 401 logout, by contrast, preserves the outbox to replay after
  re-login.

