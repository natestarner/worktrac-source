# Frontend State Notes

- **Every person has their own independent client-side state.** Whatever a person is
  currently doing or viewing — which tab/screen, selected exercise, routine position,
  draft weight/reps, exercise search text, an in-progress past-session edit, an active
  rest timer, etc. — must survive switching to another person and back. Nothing that
  represents "what this person is doing right now" should live as a single global value.
- This is the client-side mirror of the Data Model Notes above: the backend keeps each
  person's *data* separate; the frontend must keep each person's *in-progress UI state*
  separate too. Same principle, different layer.
- Implemented via three mechanisms:
  - **Server data → a `personId`-keyed TanStack Query cache** (`@tanstack/react-query`;
    client + query keys in `frontend/src/lib/queryClient.js` and
    `frontend/src/api/queryKeys.js`). Every read is a `useQuery` whose key includes the
    `personId` (account-shared reads — the exercise catalog, tags — deliberately omit it so
    they're fetched once and shared). Switching people reads a *different* cache entry, so
    Person A's data can't render under Person B. Writes are `useMutation`s that invalidate the
    right keys (single source of truth for the green "live session" dot + banner, PRs after a
    set, etc.). The cache is persisted to IndexedDB (`PersistQueryClientProvider`) and cleared
    on every auth change (`resetQueryCache`, since catalog/tags keys carry no accountId).
    Never construct query keys inline — always go through the `queryKeys` factory.
  - **Ephemeral per-person UI state → `AppStateContext`** (`frontend/src/context/AppStateContext.jsx`),
    now a `byPerson[personId]` map (each person's own slice; `activePersonId` selects which is
    live — no snapshot capture/restore). Covers current tab, selected exercise, routine
    position, weight/reps drafts, exercise search, in-progress past-session edit. Persisted per
    account to IndexedDB and rehydrated on load (first paint gated on it via `ProtectedRoute`),
    so an active routine survives a reload. Slices for removed people are pruned
    (`RECONCILE_PEOPLE`); the exposed context value still flattens the active slice to the top
    level, so consumers read `selectedExerciseId`/`weightDraft`/etc. unchanged.
    - **`lastTab` (current tab) is the one exception to "always restore where a person left
      off."** A mid-session reload must resume the persisted tab (`status` alone can't tell a
      reload apart from a fresh login — both land on `status === 'authenticated'`), but an
      actual login/registration must always land every person on Log, not wherever the
      previous session happened to be. `AuthContext.login`/`confirmEmail` set a `freshLogin`
      flag on their `setState` call (never set by the silent boot/reconnect paths); the
      `HYDRATE` reducer case in `AppStateContext.jsx` resets every restored person's `lastTab`
      to `/app/log` when it's set. Any future field that should behave like `lastTab` (reset on
      login, preserved on reload) should key off the same `resetTab`/`freshLogin` plumbing
      rather than inventing a second signal.
  - `UIContext` (`frontend/src/context/UIContext.jsx`) — state keyed by personId directly
    (e.g. `restTimers: { [personId]: {...} }`), used when a person's state needs to keep
    running independently in the background even while a *different* person is active
    (e.g. one person's rest timer must keep counting down while someone else takes their
    turn logging a set). Unchanged by the rework.
- **Freshness UX:** a cached view paints instantly; `RefreshIndicator` (driven by
  `isFetching && !isLoading`) announces any background refetch so an on-screen value never
  changes silently. Skeletons show only on genuine first load (no cache yet). The indicator
  is a sweeping bar on the sticky chrome's bottom edge, portalled out of the tab's own tree
  precisely so it can't move the content it is reporting on — see the design-system note on
  indicators for transient state.
- **When adding new client-side state, ask:** "if two people were using this on the same
  device and traded off, would one person's state leak onto the other's screen, or get
  silently reset/destroyed by the other person's actions?" If yes, it needs to go through
  one of the three mechanisms above — server data as a personId-keyed query, ephemeral UI
  state in `AppStateContext.byPerson`, or a personId-keyed `UIContext` map — not a plain
  `useState` at the top of a shared provider or component.
- Exception: toast messages, the destructive-action confirm dialog, and the PR
  celebration overlay are genuinely global, one-shot notifications tied to whatever the
  active person just did — they don't need to persist across a person switch.

