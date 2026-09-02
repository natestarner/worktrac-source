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
- **Never recolour the mark's four circles** (`#E8734A` orange, `#F2A65A` amber, `#F2EDE1`
  cream, `#B5542D` rust). **Cream is one of them, not a surface token** — it was
  `var(--color-surface)` once and rendered a near-black hole in dark mode. `HuddleMark` is the
  single copy; don't draw a second one.
- **The UI accent is deliberately NOT the mark's orange.** `#E8734A` is 2.93:1 on
  `--color-bg` and 3.01:1 under white, so it fails as a border, a focus ring and a button
  fill. `--color-accent` is that hue darkened until it passes. Don't "correct" it.
- **The mark's hairline follows the GROUND, not the theme.** `--brand-mark-hairline` is
  `#bdb6af` on light and `transparent` on dark, which is right for any ground that follows
  `prefers-color-scheme`. A ground that stays light in **both** schemes (today only
  `.plan-badge--pro`) must pass `HuddleMark`'s `hairline` prop explicitly, or the cream circle
  loses its outline in dark mode and dissolves into the pill.
- **The lockup SVGs in `assets/` carry a cropped `viewBox`** so the header keeps `height: 52`.
  Re-exporting them from the kit's own canvas silently shrinks the mark and grows the header
  — see `docs/brand/README.md` before touching them.
- **Inputs must stay at `--text-md` (16px)** or iOS Safari zooms the viewport on focus. Two e2e
  specs assert the computed value.
- **Pair shadows with the hairline**: `box-shadow: var(--shadow-3), var(--elevation-hairline)`. A
  black shadow alone is invisible on a dark surface.
- **Guard `:hover` with `@media (hover: hover)`** — without it iOS sticks the hover state after a tap.
- **New `position: fixed` chrome needs `env(safe-area-inset-*)`**, or it sits under the home
  indicator in the installed PWA.

### The sticky chrome: what's in the box decides what can paint over it

`AppShell` renders **one** `position: sticky` box (`.app-chrome`) and chooses what goes in it by
household size: the tab bar always; the person bar only at two or more people, where it's a
switcher rather than a label; the Huddle lockup never. All three used to travel together, which
spent 218px portrait / 178px landscape on permanent chrome — near half the viewport on a phone
held sideways mid-set.

- **Whatever is sticky must stay a contiguous run ending at the tab bar.** That's what keeps it a
  single element at `top: 0`. A stack of sticky siblings each needs the summed height of the ones
  above it as its own `top`, which no CSS token can know — it varies with orientation, the logo,
  and the safe-area insets.
- **`.refresh-indicator-slot` and the `::after` hairline are absolutely positioned on that box's
  bottom edge.** Anything that moves them outside it scrolls them away with the page and quietly
  breaks the zero-layout guarantee above.
- **Chrome that hangs *out* of the header must beat `--z-app-chrome`.** The header sits above the
  chrome in the document but has to paint *below* it while scrolling past, so it can't just be
  given a higher z-index. Its dropdown is a sibling of the chrome, not a child: at an equal
  z-index the later-in-DOM chrome wins the hit test and silently eats the clicks. That's
  `--z-header-menu`, and it's why `UserMenu`'s panel is the one overlay with a tokenised z-index.
  It surfaced as seven unrelated specs failing on `person-pill-bar … intercepts pointer events`.
- Crossing 1↔2 people **remounts `PersonPillBar`** (it changes tree position). Fine today — its
  only local state is `showAddPerson`, and `AddPersonModal` calls `onClose()` itself. Any new
  local state in that component needs to survive the move or not matter.

Covered by `AppShell.test.jsx` (structure) and `e2e/tests/sticky-chrome.spec.ts` (the actual
pixels — jsdom computes no layout, so only the e2e file can prove the behaviour).

### The bottom chrome: one fixed bar that reserves its own space

`SessionBar` is the counterpart to `.app-chrome` at the other edge — **one** `position: fixed` box
whose *contents* vary, mounted app-wide in `AppShell`, rendered only while the active person has a
live session. It replaced two things at once: an in-flow "Session in progress" card at the top of
the Log tab (~66px, which shoved the primary button down out from under the thumb at the exact
moment a set was logged) and a floating rest-timer pill that hovered over whatever was at the
bottom of the scroll.

- **One box, never a stack of fixed siblings** — `.app-chrome`'s rule pointed the other way.
  Siblings cannot know each other's height and no CSS token can supply it.
- **`fixed`, not `sticky`.** Sticky-to-bottom only works for an element in flow at the end of a
  scroll container; this has to hold its place over every tab.
- **Its height must not change when the rest timer starts.** A bar that grew would move the same
  tap-jump from the top of the screen to the bottom, and desync the reserved padding.
- **It must RESERVE space, not float over content.** `.app-shell`'s `padding-bottom` adds
  `--bottom-bar-height` in both the portrait and landscape rules. Growing padding-bottom moves
  nothing on screen (it only extends the scroll range), which is why this placement has no
  tap-jump. Without it the end of every tab is unreachable — and the failure presents as pointer
  interception, which is how `c100a4f` (#176) surfaced as *seven unrelated specs* failing on
  `person-pill-bar … intercepts pointer events`.
- **`--bottom-bar-height` is set on `document.documentElement`, by the bar itself.** Custom
  properties only inherit downward and **`ServiceWorkerUpdater` is mounted in `App.jsx`, outside
  `.app-shell`** — at z-1000 it would paint straight over "End workout". `Toast` needs the same
  term: it sat at the same coordinates as the old rest timer and blanked it for 3.2s. The
  component that decides whether the bar is on screen owns the reservation, so the two cannot
  drift apart.
- **`e2e/tests/session-bar.spec.ts` must keep measuring a page long enough to scroll.** A first
  cut asserted on "Log set" and passed with the reserved padding deleted — that button sits
  mid-page, so scrolling to the bottom moves it off the *top*. What the padding guarantees is that
  the **end of the document** clears the bar; a fixed bottom bar necessarily overlaps mid-document
  content at some scroll position, and asserting otherwise fails against correct code.

### Modals: `Modal` never closes on a backdrop tap

Every dialog goes through `components/shared/Modal.jsx`. The only exits are the header's X, a
footer button, and Escape — all deliberate. This app is used one-handed on an iPad mid-set, where a
stray thumb on the scrim discarded a half-built routine or an unsaved note with no confirmation and
no undo.

- **Do not reinstate an `onClick` on the scrim**, in the primitive or at a call site.
- **`onClose` is the single dismissal callback** and drives both the X and Escape. Pass `title` too
  and the header renders it and wires `aria-labelledby`; don't hand-roll a title `<div>`.
- **Escape stays.** `Modal` installs a focus trap, so it is the only keyboard exit.
- **Every modal must be closable** — an `onClose` or a footer button. Nothing enforces this
  mechanically.
- The header is `position: sticky` (with a `z-index`) because the panel is `maxHeight: 80vh` with
  its own scrollbar; a static X scrolls out of reach on the taller modals.
- **The panel itself carries no padding.** The sticky header and the content wrapper around
  `{children}` each own their own padding instead. Don't put padding back on the panel or bleed
  the header to the edges with a negative margin to "simplify" this — a negative top margin
  conflicts with the header's sticky "stuck" offset math and silently clips the first field below
  it (`docs/incidents/2026-08-10-sticky-modal-header-clips-first-field.md`).
- **Never let the visual gap between the header and the first field depend on an exact (0px)
  touching boundary.** A `position: sticky` + `z-index` element paints above ordinary flow content
  regardless of DOM order, so a real browser's sub-pixel rasterization can paint a hairline of the
  header over content it's merely adjacent to — invisible in a headless-browser screenshot, very
  visible on a real screen. Keep the gap on the plain, non-positioned wrapper below the header,
  not the header's own bottom padding.
- The X's accessible name is **"Close"**, so no other control in the same dialog may contain that
  string (`OutboxModal`'s footer button is "Done" for this reason).

`PRCelebration` is deliberately **not** a `Modal` — it is a transient celebration overlay, and
eight e2e specs dismiss it with a scrim click.

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

### State that must survive a teardown has to be written SYNCHRONOUSLY

`AppStateContext`'s snapshot goes to **localStorage** (`appStatePersistence.js`), not IndexedDB,
and that is a durability requirement rather than a size or speed preference. **Don't move it back.**

The reload that matters is one nobody chose: `swUpdate.js` force-reloads on ordinary navigation
whenever a new build exists — *always just after a deploy*. An async store cannot promise the write
landed before the document died, and **no scheduling trick fixes it**: an unload handler cannot
await, so a `pagehide`/`visibilitychange` flush cannot finish an in-flight IndexedDB transaction.
Writing on every dispatch instead of debouncing narrows the window; it does not close it. That was
the previous design, and its own comment claimed it "closes the race" — it lost that race in 38 of
51 lower runs (`docs/incidents/2026-08-14-routine-position-lost-to-async-persist.md`).

**Ask of any new persisted state: if the document died the instant after this changed, would the
change still be there?**

| State | Store |
|---|---|
| In-progress UI state, auth snapshot, token | **localStorage** — must survive an uncontrolled teardown; small and JSON-serializable |
| Query cache, durable outbox | **IndexedDB** — large/structured-clone, and loss is already tolerated (the outbox replays, the cache refetches) |

Changing the backing store is a **persisted-schema change**: keep a one-time migration that adopts
the old location and only drops it once the new write is confirmed, or every existing install
silently loses that state once on upgrade.

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

### Invalidate the key the screen READS — a session id captured at dispatch may be null

Getting the key *list* right is only half of it. `sessionSets` and `exerciseSummary` are keyed on a
session id, and **a durable write cannot trust the one it captured when it was dispatched**: for a
set logged before any session existed, `contextSessionId` is `null` for the person's entire outage,
so the queued write carries `sessionId: null` forever while the row on screen is read from the real
session's key once the create syncs. Invalidating the null key marks an empty, unobserved query
stale and silently leaves the observed one fresh — the write lands on the server and the screen
never shows it (`docs/incidents/2026-07-30-editing-queued-offline-set.md`, follow-up).

**Take the id from the server's response**, which every one of these writes already gets:
`LOG_SET` uses `data?.session?.id`, `SAVE_NOTE` uses `data?.sessionId`, `EDIT_SET` uses
`data?.sessionId` (`WorkoutSetDto` carries it). `DELETE_SET` is the one exception and is commented
as such — it has no response body, and is unreachable for an unsynced set.

Assert this against a **real cache**, never a spy on `invalidateQueries`: a spy passes just as
happily on a key nothing observes, which is exactly the failure mode.

## Writes: durable vs online-gated

| Feature | Offline? |
|---|---|
| Log/edit/delete a set, session start/end, session note, favorite/unfavorite, create a custom exercise | ✅ durable outbox |
| Add person, routine CRUD, tags, default unit, rest-timer preference, exercise rename/tags/custom fields, log a past workout, export, **import data and undo an import**, delete account, edit person, **send a Contact Us message** | ❌ gated — needs a connection |

- Offline-capable writes go through `useDurableMutation`. Tier-3 writes are gated because some
  (e.g. `createPastSession`) are **not idempotent** and would duplicate on replay.
- **Tier-3 writes go through `useGatedMutation`** — the Tier-3 counterpart to
  `useDurableMutation`. It composes `useRequireOnline` with a pending flag and, crucially, an
  error path. Before it existed every Tier-3 handler open-coded this, and most had
  `try { … } finally { setBusy(false) }` with **no catch**, so a failed write rejected into
  nothing and the person saw the spinner stop and nothing happen. A gated write has no outbox and
  no retry behind it — if it fails, saying so is the only option left.
- **The Contact Us message is gated for the usual reason — sending is not idempotent on replay.**
  The outbox retries forever across reloads and deploys, so a queued submission could reach the
  inbox repeatedly with no way for the person to see or cancel it mid-outage. What makes that
  acceptable rather than lossy is that the draft is persisted per person
  (`PERSON_DEFAULTS.contactDraft`) and cleared **only on a successful send** — so refusing offline,
  or failing outright, never costs the person what they typed. Any future gated write over
  free text needs the same pairing; a gate without a preserved draft *is* the silently-lost
  outcome the contract forbids.
- **`ImportDataModal` answers that rule differently, and deliberately.** A `File` cannot go in
  localStorage, and a multi-megabyte CSV would blow the quota `appStatePersistence` and
  `outboxSequence` depend on. Instead the modal **stays open on failure** with the file, the person
  and the preview intact — re-picking a file still sitting on the person's disk is not the same
  loss as re-typing a bug report. If you change that, the gate becomes lossy.
- `useRequireOnline` (wraps a handler, calm toast) and `OfflineDisabledWrap` (greys out an
  entry-point button) are still the gate itself, and `OfflineDisabledWrap` is still how you
  disable the control up front. Both read `useOnlineStatus` only, so they deliberately do **not**
  react to lie-fi.

## Adding an exercise that already exists opens it, and that check lives on BOTH sides

`utils/exerciseDuplicates.js`'s `resolveExerciseCreate` is the single derivation behind the Add
modal's note, its primary button and its save handler — keep it that way, so those three cannot
disagree. `ExerciseService.add` applies the same rule server-side for what a cache cannot see (two
devices creating offline, a stale catalog). Full backend contract: `.claude/rules/workout-data-model.md`.

- **It is not a connectivity branch and must not become one.** It reads whatever
  `queryKeys.exercises()` holds, by one code path in every mode. What varies while degraded is the
  *content* of that cache: on a device that has never warmed it the resolver finds nothing and the
  create proceeds exactly as before. It degrades; it never blocks, and it never gates on
  `useOnlineStatus`.
- **Matching is case-insensitive**, because SQL Server's collation is. A case-sensitive client check
  would let "bench press" through and then silently resolve to the existing row on sync — so the
  picker would show one row for an exercise the person was told they had created.
- **Opening an existing exercise must put it in the picker optimistically.** `FAVORITE` has no
  `onMutate`, only an invalidation, and an invalidation is a no-op while paused — so without the
  local write "I added it and it isn't in my list" would be true offline and false online. It is an
  add-or-patch, since a preloaded exercise the person has never favorited is not in their list at
  all (`ExerciseDetail`'s `handleToggleFavorite` only maps over rows already there). It must not
  BUILD the list — see `offline-internals.md`.
- **`exercises.name` is `NVARCHAR(200)` and `ExerciseRequest` has no `@Size`.** An over-long name is
  a DB error → 500 → `shouldRetryWrite` retries forever, head-of-line-blocking the one serial outbox
  scope. So the disambiguating `(Time)`/`(Reps)` suffix is **dropped** rather than allowed to push a
  name over the limit, and the field carries `maxLength`. Two rows sharing a name is cosmetic; a
  wedged outbox is not.

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

## Three error boundaries, and the outermost one must stay outermost

`App.jsx` renders **two**, `AppShell` a third, and their nesting is the whole point:

| Boundary | Wraps | Catches |
|---|---|---|
| **Boot** (`App.jsx`, outermost) | `PersistQueryClientProvider` and everything under it | A throw while the providers restore persisted state |
| Route (`App.jsx`, inside the providers) | `<Routes>` | A throw outside any tab — the shell, an unauthenticated route |
| Tab (`AppShell.jsx`) | The tab panel, with `resetKey={pathname}` | A throw in one tab, keeping navigation alive |

The boot boundary exists because the other two sit **inside** `AuthProvider` /
`AppStateProvider` / `UIProvider`, so a throw during hydration had nothing above it and blanked
the screen — the one outcome `resilience.md` forbids outright, and the exact shape axis D
produces (a slice predating a schema change, a cache entry that survived one, an identity
snapshot from an older build). It presents as **"the app paints, then goes white"**: the shell
renders, hydration throws a beat later, React unmounts everything.

- **Don't move it inside the providers, and don't merge it with the route boundary.** Those are
  the same position, and it is the position that failed.
- **It must never depend on what it protects.** `ErrorBoundary` is a class component with no
  hooks or context, and `CriticalErrorFallback` (its fallback here, and the route boundary's —
  see below) imports no context either — so it still renders when every provider below has
  thrown. A fallback that read `useAuth()` would throw inside the boundary and white-screen
  anyway.
- **No `resetKey` on this one**, unlike the tab boundary's. It would need `useLocation()` in
  `App`, re-rendering the entire provider tree on every navigation to reset an error that isn't
  route-scoped.
- The diagnostic half matters as much as the screen: `componentDidCatch` stashes the error via
  `lib/lastClientError.js`, so **after recovering, Contact Us offers it**. A boot throw previously
  reached us in no form whatsoever, which is why the first real occurrence could only be
  described as "it went white."

**The boot and route boundaries both use `CriticalErrorFallback`, not `ErrorBoundary`'s own
default fallback.** The default's only action is "Try again", which re-renders the SAME tree
against the SAME (possibly still-poisoned) restored state — for an axis-D throw that reliably
fails again immediately. `CriticalErrorFallback` makes a real `<a href="/login">` (not a
client-side `navigate()` — there may be no working router to hand it to) the PRIMARY action,
because that is the one thing that has twice now actually recovered a real occurrence:
`AuthContext.login()` calls `resetQueryCache()` before anything else, which "Try again" alone
never does. **Only these two boundaries** — the tab boundary keeps the plain default (a
crashed tab is not "is any of this still working", the person can just switch tabs).

### An empty `#root` is a failure mode — never `return null` from a routed component

The boundaries above catch *throws*. They cannot catch a tree that renders nothing on purpose, and
from outside React the two are identical: `boot-watchdog.js` polls `#root` and, seven seconds after
it goes empty, declares **"Huddle couldn't load"**. `AppShell`'s `if (!activePersonId) return null`
was doing exactly that — and it, not any throw, is what three white-screen reports
(2026-08-25, 2026-08-31, 2026-09-02) actually were. See
`docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md`.

- **Ask of any `return null` on a routed path: what else is on screen if this renders nothing?**
  If the answer is "nothing", it is a white screen, not a no-op. `ServiceWorkerUpdater` is the only
  other thing `App` renders beside `<Routes>`, and it renders `null` too whenever no update is
  pending.
- **A transient blank frame and a latched one need different answers**, which is why
  `NoActivePersonScreen` branches: `AppShellSkeleton` while `people.length > 0` (the auto-select
  effect fixes it on the next commit, and the skeleton is pixel-identical to what `ProtectedRoute`
  showed a frame earlier), a real card with an action when there are no people at all — because
  then nothing will ever select one.
- **A blank frame can latch itself into localStorage.** `RECONCILE_PEOPLE` nulls `activePersonId`
  and empties `byPerson` whenever the people list is empty, and `appStatePersistence` writes that
  synchronously — so a one-frame gap becomes a permanent white screen reconstructed on every boot,
  curable only by clearing site data.
- **`ProtectedRoute`'s `hydrated` gate is account-scoped for the same reason.** As a plain boolean
  the unauthenticated branch also set it, so the first render after `status` flipped to
  `'authenticated'` let `<Outlet/>` through one frame early, straight into that blank render.
  `hydrated` must keep meaning "the slice for **this** account is in state".

**A React error boundary cannot catch everything**, and this class of bug has proven itself
capable of finding the gaps: a throw inside a `useEffect` (passive, not part of React's
render/commit try-catch), or anything before React ever calls `render` at all. Belt-and-suspenders
for exactly that gap: `frontend/public/boot-watchdog.js`, a plain script (not a module, not part
of the bundle) that polls whether `#root` has ever painted anything and shows a static, dependency-
free "go to login" fallback if it hasn't — see that file's own header for the full reasoning and
why it's a deliberately different mechanism from the three boundaries rather than a fourth one of
the same kind.

`App.bootBoundary.test.jsx` / `App.routeBoundary.test.jsx` pin the two `CriticalErrorFallback`
boundaries by mocking something inside each to throw. `boot-watchdog.spec.ts` (e2e — the watchdog
runs outside anything Vitest exercises) pins the backstop by emptying `#root` directly, standing
in for "every boundary got bypassed" without needing to reproduce a specific real crash. All
verified non-vacuous: remove what each covers and the corresponding case fails.

## Boot chrome renders for real, but must not be interactive

`ProtectedRoute` shows `AppShellSkeleton` until auth resolves *and* the persisted state rehydrates,
then swaps in `AppShell`. Both render `<Header/>`, in **different tree positions** — so that swap
unmounts the skeleton's header and mounts a new one. Any local component state in the discarded
tree is gone, and `UserMenu`'s `open` is plain `useState`.

- **`AppShellSkeleton` renders real chrome for PIXELS, not for behaviour.** Its `<Header booting/>`
  keeps the account control visible (no layout shift) with the trigger disabled, because a menu
  opened during boot would close itself the moment boot finished — silently, with no sign the tap
  was discarded. A 2.7s window was measured under load, and it is widest exactly when boot is
  slowest: cold start, lie-fi, a poor connection.
- **Any new interactive control added to that skeleton needs the same treatment.** If it can be
  clicked, it must either survive the swap or be inert until it does.
- This is also why driving the app mid-boot is safe now: a disabled button fails Playwright's
  actionability check, so a click waits for the surviving header instead of opening a doomed menu.

See `docs/incidents/2026-08-13-e2e-parallel-flakiness.md`.

## Per-row UI state

"Saving…" is reserved for a write's **first in-flight attempt**. Once paused, retrying, or in a
transient error, a row gets Edit/Delete controls immediately — as durable/editable as a synced
row — rather than an indefinite spinner over a request that may never succeed. The banner's
outbox count is what signals "not yet synced", not the row.

**It only covers LOG_SET creates.** `ExerciseDetail` gates it on `set.optimistic` and derives it
from `logSetMutationKey`, so an in-flight edit, delete, note, favorite or end-workout has no row
mark at all. Don't reason about it as a general "a write is in flight" signal — it isn't one.

### Two predicates, two questions: never use the display one for a destructive decision

`useOutboxCount`'s `countQueuedWrites` (paused / errored / `failureCount > 0`) answers **"what
should I show?"**. It deliberately omits a brand-new first attempt still in flight so a fast online
write doesn't flash the banner — correct for chrome, and it must stay.

`getUnsyncedWriteCount` (built on `isUnsyncedWrite`) answers **"would anything be destroyed if the
outbox were thrown away right now?"**, and a write on the wire counts. That is the one the logout
guard asks, because `logout()` clears both the in-memory outbox and its persisted copy — so a
request that fails after that has nothing left to retry from. Asking the display predicate left the
last write of a drain unguarded while `AuthContext`'s own comment claimed the warning made the
discard "a confirmed choice, not silent data loss".

**Any new destructive or irreversible action gates on the safety predicate, never the display
one.** The two are pinned side by side in `useOutboxCount.test.jsx` precisely so the divergence
reads as deliberate rather than as an inconsistency to unify.

## Freshness UX

A cached view paints instantly; `RefreshIndicator` (`isFetching && !isLoading`) announces any
background refetch so an on-screen value never changes silently. Skeletons show only on genuine
first load.

### A transient indicator must not be able to move the content it reports on

`RefreshIndicator` renders in two places and **neither is in the calling tab's flow**: the visible
bar is portalled into `.refresh-indicator-slot` (absolutely positioned on the sticky chrome's
bottom edge, rendered by `AppShell`), and the announcement stays behind as a zero-layout `.sr-only`
live region. It was an in-flow pill, and with a 60s `staleTime` that pushed the page down ~35px and
yanked it back on every background refetch.

- **Don't move the bar back into a tab, and don't "simplify" it by reserving a fixed-height slot
  instead.** A reserved slot costs that space permanently on four tabs to smooth over a couple of
  seconds of it; floating it over the tab content has no safe anchor (top-right lands on History's
  "Export data" and the PRs sort row). Persistent chrome is the only placement that reserves
  nothing, occupies nothing and overlaps nothing at the same time.
- **The live region is rendered unconditionally, empty when idle.** Screen readers announce changes
  *within* an existing live region; mounting a populated one and unmounting it is the unreliable
  version. Don't "clean it up" by rendering it only while refreshing.
- **The portal target is resolved in an effect, not during render** — on the initial mount the tab's
  own DOM is committed before `AppShell`'s slot exists to look up. A missing slot degrades to "no
  bar" (that's every tab's own unit test), never a crash or a stray bar in the tab.
- `e2e/tests/refresh-indicator.spec.ts` measures the bounding box of a History row during and after
  a refresh. Verified non-vacuous: an in-flow node in the indicator fails it by exactly 35px.
- **This applies to any new transient indicator**, not just this one. A *persistent* notice is the
  opposite call and stays in flow — see the reasoning in `OfflineDataNotice`'s header.

`OfflineDataNotice` is the offline half of that slot, and it reports **both** halves of the truth:
the `dataUpdatedAt` timestamp *and* `useOutboxCount`, because on these four tabs a queued write is
not merely un-refreshed — none of them has an optimistic writer, and invalidation is a no-op while
paused, so the queued set is **absent** from what's on screen. A timestamp alone reads as "slightly
old" when the list is actually incomplete.

- **Read the count from `useOutboxCount`**, the same hook `OfflineBanner` uses, so the two can
  never disagree about how much is outstanding.
- **Its wording must share no phrase with the banner's `"N changes waiting to sync"`.** Both are on
  screen at once, and Playwright (substring) and RTL both select the banner's count by that text.
