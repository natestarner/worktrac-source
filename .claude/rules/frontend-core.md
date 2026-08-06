---
paths:
  - "frontend/src/**"
---

# Frontend invariants

Applies to all frontend source. Full narrative: `docs/architecture/frontend-state.md` and
`docs/architecture/offline-mode.md`.

Style: JavaScript/React, **2-space** indentation, ESLint + Prettier.

## Every person has their own independent client-side state

Whatever a person is currently doing or viewing — tab/screen, selected exercise, routine position,
draft weight/reps, search text, an in-progress past-session edit, an active rest timer — **must
survive switching to another person and back**. Nothing representing "what this person is doing
right now" may live as a single global value. This is the client-side mirror of the backend's
per-person data separation.

Three mechanisms, pick the right one:

1. **Server data → a `personId`-keyed TanStack Query cache.** Every read is a `useQuery` whose key
   includes the `personId` (account-shared reads — exercise catalog, tags — deliberately omit it).
   **Never construct query keys inline — always go through the `queryKeys` factory**
   (`api/queryKeys.js`).
2. **Ephemeral per-person UI state → `AppStateContext`'s `byPerson[personId]` map.**
3. **`UIContext`** — keyed by personId directly, for state that must keep running in the
   background while a *different* person is active (e.g. one person's rest timer counting down
   while someone else logs a set).

**When adding new client-side state, ask:** "if two people traded off on this device, would one
person's state leak onto the other's screen, or get silently reset by the other's actions?" If
yes, it needs one of the three above — not a plain `useState` in a shared provider or component.

Exceptions that are genuinely global one-shot notifications: toasts, the destructive-action
confirm dialog, the PR celebration overlay.

### `lastTab` is the one exception to "always restore where they left off"

A mid-session reload must resume the persisted tab, but an actual login/registration must land
every person on Log. `AuthContext.login`/`confirmEmail` set a `freshLogin` flag (never set by the
silent boot/reconnect paths); `HYDRATE` resets every restored person's `lastTab` to `/app/log`
when set. **Any future field that should behave like `lastTab` must key off the same
`resetTab`/`freshLogin` plumbing**, not a second signal.

Both `AuthContext` effects that call `apiMe()` in the background discard their response if the
current auth token no longer matches the one active when the call was made — a general "is this
response still relevant" guard. See `docs/incidents/2026-07-31-stale-me-clobbers-freshlogin.md`.

## Writes: durable vs online-gated

| Feature | Offline? |
|---|---|
| Log/edit/delete a set, session start/end, session note, favorite/unfavorite, create a custom exercise | ✅ durable outbox |
| Add person, routine CRUD, tags, default unit, rest-timer preference, exercise rename/tags/custom fields, log a past workout, export, delete account, edit person | ❌ gated — needs a connection |

- Offline-capable writes go through `useDurableMutation`. Tier-3 writes are gated because some
  (e.g. `createPastSession`) are **not idempotent** and would duplicate on replay.
- Gate with `useRequireOnline` (wraps a handler, calm toast + disabled control) or
  `OfflineDisabledWrap` (greys out an entry-point button). Both read `useOnlineStatus` only, so
  they deliberately do **not** react to lie-fi.

## A durable write is not the same as a visible value

A per-session display value needs its own pending-mutation fallback. `contextSessionId` stays
`null` for a person's entire offline/lie-fi stretch, so any query keyed on it
(`enabled: !!contextSessionId`) never runs — the write is durably queued and guaranteed to sync,
while the value it produced stays invisible the whole time.

**When adding a new per-session display value, ask:** would it stay blank for a person whose
current session hasn't synced yet? If yes, either derive it from an already-warmed,
session-independent cache (`history`), or read it straight from the mutation's own variables via
`useMutationState` (filtered by `mutationKey` + the relevant ids, excluding `status === 'success'`
and definitive-4xx failures). Cache invalidation alone is a no-op while paused offline.

## Per-row UI state

"Saving…" is reserved for a write's **first in-flight attempt**. Once paused, retrying, or in a
transient error, a row gets Edit/Delete controls immediately — as durable/editable as a synced
row — rather than an indefinite spinner over a request that may never succeed. The banner's
outbox count is what signals "not yet synced", not the row.

## Freshness UX

A cached view paints instantly; `RefreshingPill` (`isFetching && !isLoading`) announces any
background refetch so an on-screen value never changes silently. Skeletons show only on genuine
first load.
