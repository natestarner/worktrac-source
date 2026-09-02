---
paths:
  - "frontend/src/**"
  - "backend/src/main/java/**"
  - "e2e/**"
---

# The degraded-conditions contract

Broad `paths:` on purpose — this is the one invariant that applies to all product code. It stays
short and links out rather than restating `offline-internals.md`, `frontend-core.md` or
`backend-core.md`. Full narrative and the reasoning behind each row:
`docs/architecture/resilience.md`.

**The contract: the app behaves the same in every condition below. Degradation is the default
case, not an edge case.** A failure degrades to *queue and retry* or *show what's cached* — never
to signed-out, blank, silently-lost, or a spinner over a request that will never succeed.

## The four axes — consider a change against each

### A. Reachability — what the network does
| Condition | What makes it distinct |
|---|---|
| Online, healthy | The baseline every other row is compared against |
| **Slow but alive** | `api/client.js` aborts at `REQUEST_TIMEOUT_MS`; a merely-slow backend is indistinguishable from a dead one to the client |
| **Lie-fi** | Only a **rejected** fetch trips `reachabilityMonitor` (3 consecutive). Drives `ConnectionTroubleBanner` |
| **Hard offline** vs **user-pinned offline** | **Different states.** The pin (`lib/offlineMode.js`) suspends `onlineManager`'s event listener, survives reload, never auto-unpins. Something correct under `setOffline` can still be wrong under a pin |
| **Flapping** | Repeated online↔offline transitions. Has caused duplicate writes — `connectivity-transitions.spec.ts` |

### B. The server answers, but not with success
| Condition | What makes it distinct |
|---|---|
| **Cold start / scale-to-zero** | Lower runs `min-replicas=0`. The ingress **holds the connection ~35s** while a replica starts — it does not refuse and does not 503 (measured 2026-09-02). So the client's 15s abort fires FIRST: the first call after a scale-to-zero always fails, by arithmetic. **A simulated hang shorter than that abort proves nothing** — fourteen rounds of investigation came back clean for exactly this reason. A fulfilled 5xx, when one does arrive, resets the reachability counter, so this does _not_ trip lie-fi either |
| **DB down, backend up** | `GlobalExceptionHandler` → honest 503. Must degrade to "queue and retry", **never** "you are signed out" (`docs/incidents/2026-07-27-db-outage-forced-logout.md`) |
| **DB slow / pool exhausted** | Hikari default max 10; lower/prod `connection-timeout: 60000`. Requests hang past the client's abort, so a *busy* server presents as lie-fi |
| **Definitive 4xx** | The only thing allowed to end a durable write's retries (`shouldRetryWrite`) |

### C. Client lifecycle — what the device does
| Condition | What makes it distinct |
|---|---|
| **Reload / cold boot at an arbitrary instant** | The query persister is throttled at 1s — anything changed inside that window was never written |
| **Service-worker silent forced reload** | `swUpdate.js`'s `tryForceUpdate` reloads on ordinary navigation whenever a new build exists — i.e. **always just after a deploy** |
| **Storage unavailable / evicted** | Private mode, quota, disabled storage. Persistence modules swallow this and degrade to in-memory |
| **Multi-tab / multi-device** | One shared `worktrac-outbox:<accountId>` IndexedDB key |
| **Person or account switch mid-outage** | `adoptOutboxAccount()`'s ordering is load-bearing; per-person isolation must hold while writes are queued |

### D. State restored from an earlier world
| Condition | What makes it distinct |
|---|---|
| **Persisted slice predating a schema change** | Test the **upgrade** path (a slice missing the new key), never just a fresh profile |
| **Restored cache that looks fresh but isn't** | `dataUpdatedAt` survives the round trip, so a restored entry passes every staleness check |
| **Unresolved temp ids** | A dependent write whose `temp-exercise-…` / `optimistic-…` id hasn't mapped yet |
| **Render-time throw** | Must be contained by an error boundary, not white-screen the app |

## Reuse the mechanism — don't invent one

There is already exactly one way to do each of these. **Adding a second is the bug.**

| Need | Use | Not |
|---|---|---|
| Offline-capable write | `useDurableMutation` (component) / `dispatchDurableWrite`, `enqueueOutboxWrite` (non-component) | A bare `useMutation`, or calling `api/*` directly |
| Online-only (Tier-3) write | `useGatedMutation` (the **only** caller of `useRequireOnline`) | Calling `api/*` directly; an ad-hoc `try/catch` + toast per call site; `useRequireOnline` on its own |
| Disabling a Tier-3 entry point up front | `OfflineDisabledWrap` | Hand-rolled `disabled={!online}` |
| "Am I online?" | `useOnlineStatus` (never reflects lie-fi — deliberate) | `navigator.onLine`, a second connectivity flag |
| "Is the backend struggling?" | `useConnectionTrouble` | Inspecting query error state by hand |
| Ordering queued writes | `byEnqueueOrder` / `enqueueSeq` | TanStack's `submittedAt` — re-stamped on every re-execute |
| Retry policy for a write | `shouldRetryWrite` | A per-mutation `retry` option |
| "Has this write not synced yet?" | `isUnsyncedWrite` | `status === 'pending'` |
| Data available offline | Add the key to `offlineCacheWarm.js` | A per-screen fallback fetch |
| HTTP | `api/client.js` | A raw `fetch` |
| Reachability check | `probeReachability` | A second health ping |

`scripts/check-resilience-invariants.sh` enforces the mechanical half of this table; CI and the
session `Stop` hook both run it.

## The register of sanctioned divergences

Behavior legitimately differs by condition **only** in the places below. Each is deliberate and
was expensive to arrive at. **A branch on connectivity that is not on this list is a bug until it
is added here with a reason** — and none of these may be "simplified" away.

| Where | Divergence | Why it must stay |
|---|---|---|
| `useRequireOnline` / `OfflineDisabledWrap` | Tier-3 writes refuse offline | Some (`createPastSession`) are **not idempotent** — queueing them would duplicate on replay |
| `useOnlineStatus` | Reflects hard-offline and the pin, **never lie-fi** | Lie-fi must not disable Tier-3 controls; the server may still be answering |
| `offlineCacheWarm.js` | No-ops when offline | Warming is meaningless with no network |
| `AuthContext` | `isOfflineError && snapshot` → degrade; real 4xx → sign out | The single highest-consequence branch in the app (`2026-07-27`) |
| `ExerciseDetail.jsx` | `summaryQuery.isPaused \|\| isError` → derived summary | Hard-offline pauses, lie-fi errors; both need the derived value |
| `offlineCacheWarm.js` | `refreshAfterRestore` is **opt-in per key** | Forcing a refetch destroys a key holding state that hasn't reached the server |
| Three PR predicates (`log-screen.md`) | Backend celebration, History ★, and Log pill differ | Deliberately not unified — see `log-screen.md` |
| `2026-07-30`'s two accepted UX costs | Revert-then-correct flicker; PR celebration reflects the pre-edit value | "Fixing" them reintroduces connectivity-mode special-casing, which is what the redesign exists to remove |
| `LogTab.jsx`'s MutationCache subscriber | Calls a state setter inline, unlike the three hooks | Deliberately left alone; see `offline-internals.md` |
| DB-down, backend-up | A *pinned* user can't unpin (health 503); an *unpinned* user stays "online" (a 503 is a fulfilled response, so lie-fi never trips) | Both degrade correctly by different routes. Do **not** "fix" one to match the other |
| `AddEditExerciseModal` | Three save paths: rename → gated, `requireSyncedExercise` → gated, everything else → durable outbox | Routines sends the new exercise's id straight into a non-idempotent `createRoutine`, which cannot replay against a temp id. All three now share **one** gate/error mechanism; only the branch itself is local |
| `ImportDataModal` | Branches on **file type** (`.xlsx` → lazy converter, else `file.text()`), never on connectivity | Not a connectivity branch at all; listed only so the `await import(...)` beside a gated write doesn't read as one |
| `SessionSummary` remove | The deletes are durable, but the entry point stays `OfflineDisabledWrap`ped | Enumerating which rows to delete needs a live `listSessionSets` read. The *write* is no longer the limitation — the *read* is |
| `getRaw` (export) and `IMPORT_TIMEOUT_MS` (import) | 60s timeout vs `request`'s 15s | A full-history export — and an import of one, with thousands of inserts behind it — is legitimately slow; aborting a working transfer would be worse. Bounded is the point, not the number |
| `AUTH_TIMEOUT_MS` (`login`, `confirm-email`) | 45s timeout vs `request`'s 15s | 15s is right everywhere else *because something better waits behind it* — a read falls back to the cache, a write to the outbox, boot `/me` to the auth snapshot. Credentials have no fallback: an aborted sign-in is just a sign-in that didn't work. Lower's measured cold start is ~35s with the ingress **holding** the connection, so at 15s the first sign-in after a scale-to-zero was arithmetically certain to fail (`docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md`) |

## Prove it, don't argue it

- Any user-visible flow gets a parity test via `e2e/tests/support/parity.ts`'s
  `forEachConnectivityMode` — one assertion body, run across modes. Prose claiming a flow "behaves
  identically in every connectivity mode" is what we had before; it was wrong twice.
- A parity test that could pass vacuously guards nothing. Verify it fails when you break one mode.
- Service-worker-dependent behavior belongs in `offline-durability.spec.ts` (`npm run test:pwa`).
- Before changing any area with a `docs/incidents/` entry, **read that entry first.**
