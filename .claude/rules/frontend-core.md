---
paths:
  - "frontend/src/**"
---

# Frontend invariants

Applies to all frontend source. Full narrative: `docs/architecture/frontend-state.md`,
`docs/architecture/offline-mode.md` and `docs/architecture/design-system.md`.

Style: JavaScript/React, **2-space** indentation, ESLint + Prettier.

## Styling: use the tokens and the primitives

Every value the UI draws with is a token in `frontend/src/index.css`. **A raw literal in a
component is the bug** — that's how 17 font sizes, 13 radii and 8 one-off shadows accumulated.
Full reasoning: `docs/architecture/design-system.md`.

- **Reach for a primitive before writing a style object.** `Button` (with `variant`/`size`), `Card`,
  `Input`, `IconButton`, `SectionLabel`, `EmptyState` in `components/shared/`. At most **one**
  `variant="primary"` visible per screen.
- **Anything interactive needs `className="pressable"`** so it gets the press/hover transition, and
  it must reach the 44px touch target (`sm` variants at 40px for dense rows). This app is used on an
  iPad mid-workout.
- **Pick the right accent token.** `--color-accent` is 3.44:1 as small text and **fails AA** — use
  `--color-accent-text` for text, `--color-accent-strong` for small filled buttons, and
  `--color-accent` only for fills behind large bold text, borders, icons and the focus ring.
- **`--color-faint` is not a text colour.** Dividers, inactive glyphs and dashed borders only; body
  copy and empty states use `--color-muted`.
- **Inputs must stay at `--text-md` (16px)** or iOS Safari zooms the viewport on focus. Two e2e
  specs assert the computed value.
- **Pair shadows with the hairline**: `box-shadow: var(--shadow-3), var(--elevation-hairline)`. A
  black shadow alone is invisible on a dark surface.
- **Guard `:hover` with `@media (hover: hover)`** — without it iOS sticks the hover state after a tap.
- **New `position: fixed` chrome needs `env(safe-area-inset-*)`**, or it sits under the home
  indicator in the installed PWA.

### Changing a control's visible text or label can break tests elsewhere

Both test layers select by accessible name, with **different matching rules**: Playwright's `name`
is a case-insensitive **substring** by default; RTL's is a **full string**. So adding a control
whose label contains an existing one on the same screen (`"Edit note…"` beside `"Edit"`) breaks
`toHaveCount` assertions elsewhere. Keep labels on one screen mutually non-containing.

When converting a text button to an icon button, the icon is `aria-hidden` and the **button keeps
the former text as its `aria-label`, verbatim** — ~40 e2e assertions select set-row controls by
`"Edit"` / `"Delete"`.

Also: **RTL's `getByText` concatenates only DIRECT text-node children.** Splitting a string into
spans to style part of it silently breaks every `getByText` on it. Don't do it to a string a test
looks rows up by.

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

### Adding a field to `PERSON_DEFAULTS` is a persisted-schema change

`HYDRATE` underlays `PERSON_DEFAULTS` beneath every restored slice
(`{ ...PERSON_DEFAULTS, ...slice }`) so a field added *after* a slice was persisted hydrates as its
default rather than `undefined`. **Keep that merge.** Without it, every new field ships an
`undefined` to every existing user until they happen to touch the control that sets it — which is
how the Trends weekly-metric switcher blanked the page on hover for anyone who used the app before
it shipped (`docs/incidents/2026-08-08-trends-hover-blank-page.md`).

The merge does not cover changing what an *existing* field's values mean — that still needs a
`SCHEMA_VERSION` bump in `appStatePersistence.js`. And test the **upgrade** path (a slice missing
the new key), not just a fresh profile: a brand-new person never reproduces this class of bug.

### `lastTab` is the one exception to "always restore where they left off"

A mid-session reload must resume the persisted tab, but an actual login/registration must land
every person on Log. `AuthContext.login`/`confirmEmail` set a `freshLogin` flag (never set by the
silent boot/reconnect paths); `HYDRATE` resets every restored person's `lastTab` to `/app/log`
when set. **Any future field that should behave like `lastTab` must key off the same
`resetTab`/`freshLogin` plumbing**, not a second signal.

Both `AuthContext` effects that call `apiMe()` in the background discard their response if the
current auth token no longer matches the one active when the call was made — a general "is this
response still relevant" guard. See `docs/incidents/2026-07-31-stale-me-clobbers-freshlogin.md`.

## A set write invalidates every view derived from sets

`queryClient.js`'s `LOG_SET` `onSettled` and `reconcileSetChange` must invalidate **all** of
`sessionSets`, `exerciseSummary`, `prs`, `history`, and — via `invalidateTrends` — the three
trends prefixes. Trends was missing from that list for a long time, and with `staleTime` at 60s
that meant logging your first-ever set and opening Trends still said *"No workouts logged yet"*.

**When adding any new read that derives from logged sets, add it to those two handlers.** Ask:
"if someone logs a set and opens this view five seconds later, is it right?" A prefix key
(`trendsForPerson`, not `trendsOverview(personId, weeks)`) is needed whenever the full key carries
something the writer can't know — the trends keys carry a `weeks` and an `exerciseId`.

Note this is the opposite call from `offlineCacheWarm.js`, which deliberately *excludes* trends:
warming them is a costly prefetch fan-out across every person, whereas invalidating them is free
(nothing refetches until the tab is actually mounted).

## Writes: durable vs online-gated

| Feature | Offline? |
|---|---|
| Log/edit/delete a set, session start/end, session note, favorite/unfavorite, create a custom exercise | ✅ durable outbox |
| Add person, routine CRUD, tags, default unit, rest-timer preference, exercise rename/tags/custom fields, log a past workout, export, delete account, edit person | ❌ gated — needs a connection |

- Offline-capable writes go through `useDurableMutation`. Tier-3 writes are gated because some
  (e.g. `createPastSession`) are **not idempotent** and would duplicate on replay.
- **Tier-3 writes go through `useGatedMutation`** — the Tier-3 counterpart to
  `useDurableMutation`. It composes `useRequireOnline` with a pending flag and, crucially, an
  error path. Before it existed every Tier-3 handler open-coded this, and most had
  `try { … } finally { setBusy(false) }` with **no catch**, so a failed write rejected into
  nothing and the person saw the spinner stop and nothing happen. A gated write has no outbox and
  no retry behind it — if it fails, saying so is the only option left.
- `useRequireOnline` (wraps a handler, calm toast) and `OfflineDisabledWrap` (greys out an
  entry-point button) are still the gate itself, and `OfflineDisabledWrap` is still how you
  disable the control up front. Both read `useOnlineStatus` only, so they deliberately do **not**
  react to lie-fi.

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
