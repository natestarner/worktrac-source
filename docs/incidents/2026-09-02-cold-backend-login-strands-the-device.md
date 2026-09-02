# The boot white screen: root cause found, three deploys later

**Date:** 2026-09-02
**Area:** Frontend — app boot, sign-in ordering, `AppShell`'s no-active-person render
**Symptom (user's report, verbatim in substance):** on lower, with the backend scaled to zero, a
reload — whether triggered by the "new version available" prompt or an ordinary browser refresh —
made the app "flash for a moment, then go to a blank white screen, then eventually the fallback of
*we couldn't load the page*". After that, **reloading never fixed it**. Signing in did log them in
"but none of the user's data is in there", and the data "eventually after a long time" came back.
The same account on another browser was fine throughout. **Clearing the cache fixed it.**
Reproduced on Brave mobile *and* Safari mobile.

This closes `2026-08-31-boot-white-screen-recurrence.md`, which after fourteen rounds of live
testing ended with "the connection-quality trigger itself is still not something this pass
reproduced from first principles". It is reproduced here, from first principles, in a browser.

## What was actually wrong

Three defects, all on the cold-backend path, each of which the previous investigations had walked
past because each looks harmless in isolation.

### 1. `login()` tore down the device's fallback state before it had a replacement

`AuthContext.login()` (and `confirmEmail()`) ran, in this order:

```js
const { token } = await apiLogin({ email, password });
resetQueryCache();      // discards the persisted query cache, AND removes it from IndexedDB
clearAuthSnapshot();    // discards the identity the app boots offline from
setAuthToken(token);    // persists the new token
const data = await apiMe();
saveAuthSnapshot(data); // ...only now is anything put back
```

Every teardown happened before the app had anything to put back, and the token was persisted
before `/me` had confirmed anything. That is fine right up until `/me` doesn't answer.

**On lower it routinely doesn't.** Measured 2026-09-02 against the deployed lower backend, cold:

```
OPTIONS /api/auth/me   code=200  connect=0.09s  ttfb=35.72s  total=35.73s
```

The Container Apps ingress **holds the connection open** for ~35s while a replica starts. It does
not refuse, and it does not 503. `api/client.js` aborts at `REQUEST_TIMEOUT_MS` = 15s. So the first
`/me` after a scale-to-zero does not merely *risk* failing — it is arithmetically **certain** to.

What that left on the device: a **valid token**, **no auth snapshot**, **no persisted query cache**.

Reproduced directly (`e2e/loginrace.mjs`, since removed):

```
[poison] TOKEN present: true
[poison] SNAPSHOT present: false
```

### 2. That state is a terminal boot with no exit

`AuthContext`'s boot effect cannot distinguish a stranded token from a live session whose server is
briefly down, and correctly refuses to sign someone out over a transient outage. With no snapshot
it holds `status: 'loading'` and retries forever — and `ProtectedRoute` renders `loading` as
`AppShellSkeleton`. There was no bound, no message and no escape. A reload lands in exactly the
same state, which is why reloading never helped and only clearing site data did.

Measured, on the unfixed build:

```
[reboot] t+3s  ... {"n":1,"t":"Account ▾ Log History PRs Routines Trends"}
   ...
[reboot] t+81s ... {"n":1,"t":"Account ▾ Log History PRs Routines Trends"}
```

81 seconds and still going. This is precisely the "spinner over a request that will never succeed"
outcome `.claude/rules/resilience.md` rules out.

### 3. `AppShell` rendered literal nothing — and that is what the white screen was

```js
if (!activePersonId) {
  return null;
}
```

`ProtectedRoute` renders `<Outlet/>` → `AppShell` → `null`. `ServiceWorkerUpdater` also renders
`null` when no update is pending. So `#root` is **empty** — and `boot-watchdog.js` reports an empty
`#root`, after seven seconds, as **"Huddle couldn't load"**. That is the fallback in the report,
and it was firing correctly: from outside React, a tree that renders nothing and a tree that never
rendered are the same thing.

Reproduced end to end (`e2e/blankroot.mjs`, since removed), unfixed build:

```
t+1s  {"n":0,"t":""}
   ...
t+6s  {"n":0,"t":""}
t+7s  {"n":1,"t":"Huddle couldn't load Something went wrong loading the app..."}
```

with instrumentation confirming the mechanism:

```
SHELL t=0.15 activePersonId=null people=0
```

Two ways in, and they behave differently:

- **`people.length > 0`** — transient. `AppShell`'s own auto-select effect picks the primary person
  on the next commit. Observed live at ~10ms. Invisible, but it *is* an empty `#root`.
- **`people.length === 0`** — **permanent**, and self-reinforcing. Nothing will ever select a
  person. Worse, `RECONCILE_PEOPLE` nulls `activePersonId` and empties `byPerson` the first time
  the people list is empty, and `appStatePersistence` writes that to localStorage **synchronously**
  — so every later boot starts there too. A one-frame gap becomes a permanent white screen that
  survives every reload. Only clearing site data clears it.

There was also a fourth, smaller hole feeding the same render: `ProtectedRoute` gates on
`useAppState().hydrated`, but `hydrated` was a plain boolean that `AppStateContext`'s
*unauthenticated* branch also set. On the first render after `status` flipped to `'authenticated'`
it still read `true` while the reducer still held `initialState` — so the gate let `<Outlet/>`
through one frame early, straight into the `activePersonId === null` render above.

## How all four of the user's symptoms fall out of this

| Reported | Mechanism |
|---|---|
| "flashes the app, then blank white, then *we couldn't load the page*" | Boot skeleton (which looks like the app) → `AppShell` returns `null` → empty `#root` → watchdog at 7s |
| "clicking reload never fixes the problem" | Both terminal states are reconstructed from localStorage on every boot |
| "logging in works but none of the user's data is in there" | `resetQueryCache()` had already removed the persisted cache from IndexedDB, and every refetch was timing out against a backend still cold-starting |
| "eventually after a long time the data does come back" | The backend finished starting; queries and the 5-minute warm tick finally succeeded |
| "clearing cache fixes it" | It is the only thing that clears the stranded token and the latched `activePersonId: null` |
| Reproduced on Brave **and** Safari mobile | Nothing browser-specific here, which retires the standing Brave-Shields hypothesis |

The 2026-08-31 investigation could not reproduce this because every round it ran either had a valid
snapshot on disk (so boot degraded correctly, as designed) or hung requests for **8 seconds** —
comfortably inside the client's own 15s abort. The regime that breaks the app needs a hang
**longer** than the abort, which is the only regime lower's 35s cold start actually produces.

## The fix

1. **`verifyNewSession()` in `AuthContext`** — one choke point for both credential paths. It sets
   the token, awaits `/me`, and only *then* discards the previous household's snapshot and query
   cache. If `/me` fails with anything that isn't a definitive 4xx, it **puts the previous token
   back**, so a failed sign-in leaves the device exactly as it found it. (A 4xx is excluded because
   `api/client.js` has already cleared the token and run the unauthorized handler — restoring it
   would resurrect a session the server just rejected.)
2. **`BOOT_STALL_AFTER_ATTEMPTS`** — after three consecutive unreachable-server `/me` attempts with
   no snapshot, the boot flags `bootStalled` and `ProtectedRoute` renders `CriticalErrorFallback`
   ("Huddle can't reach the server") with a real `<a href="/login">` instead of a skeleton. This
   bounds the **visibility** of the wait, not the retry: the token is not cleared, the retry keeps
   running, and a backend that comes back heals the screen with no interaction. Three attempts
   because attempts 1–2 failing *is* the ordinary scale-to-zero path.
3. **`NoActivePersonScreen`** replaces `return null` in `AppShell`. `AppShellSkeleton` for the
   transient case (pixel-identical to what `ProtectedRoute` showed a frame earlier, so nothing
   flashes); a real "No one to log for yet" card with **Add a person** and **Go to login** for the
   permanent one.
4. **`hydrated` is account-scoped** — it now answers "the slice for *this* account is in state",
   closing the one-frame gate hole.
5. **`AUTH_TIMEOUT_MS` (45s) for `login` and `confirm-email`.** Everywhere else 15s is right
   *because* something better waits behind it — a read falls back to the cache, a write to the
   outbox, boot `/me` to the snapshot. Credentials have no fallback: an aborted sign-in is just a
   sign-in that didn't work. This is on the register in `.claude/rules/resilience.md`.
6. **A timed-out request no longer surfaces `"signal is aborted without reason"`** (the
   `AbortController`'s own `DOMException` message, which `LoginPage` rendered verbatim into its
   error banner). It is re-thrown as a statusless `ApiError` with a human message — statusless, so
   `isOfflineError` and `shouldRetryWrite` classify it exactly as before.

## Found on the way out: closing the blank frame exposed a live destructive bug

Fixing (4) turned `reload-persistence.spec.ts`'s "an active routine survives a page reload" red —
reproducibly, and green again with the change stashed. It was not flake, and it was not a
regression in the ordinary sense: **the spec was only passing by accident.**

`LogTab` ends an active routine when the routines list doesn't contain it — a destructive decision
on restored state — gated on `dataUpdatedAt`, with a comment asserting that value "stays 0/falsy
until a REAL fetch has actually completed at least once". **That is false for a hydrated entry.**
`dataUpdatedAt` survives the persist/hydrate round trip, so a restored list reports itself freshly
fetched. This is exactly `2026-08-08-restored-cache-looks-fresh.md`, in a place that makes a
destructive decision from it.

The only thing preventing that was render ordering: `ProtectedRoute` used to let `<Outlet/>`
through a frame early, so `AppShell` — and with it `useOfflineCacheWarming`'s boot warm — mounted
*before* `LogTab`, and `isFetching` was already true by the time this effect first ran. Closing the
blank-frame hole removed that head start, and the effect began ending a live routine on **every**
reload, from a persisted snapshot that predated the routine (the persister is throttled at 1s).

The same gate was also wrong **offline**, independently of any of this: a paused query reports
`isFetching: false` while carrying restored data, so the effect would end a routine on evidence it
could not possibly have revalidated.

The gate now reads **`isFetchedAfterMount`**, which TanStack derives from the fetch count against
the observer's own initial snapshot — so hydrated data reads `false` until the network actually
confirms it, online or off. Not ending a routine whose deletion cannot be confirmed is the correct
degradation; the next online mount reconciles it.

## Verification

Every fix was reproduced failing and then confirmed passing in a real browser against a production
build with the service worker live, including a genuine old-SW → new-SW handoff driven by clicking
the real "Reload" banner with the backend held open.

- `cold-backend-recovery.spec.ts` — both scenarios. Verified non-vacuous: reverting `AppShell` to
  `return null` fails the first, and reverting the `login()` ordering fails the second.
- `AuthContext.offlineBoot.test.jsx` — sign-in atomicity and the stall flag. Verified non-vacuous:
  restoring the old ordering fails exactly the two new sign-in tests.
- `ProtectedRoute.test.jsx`, `AppStateContext.hydration.test.jsx`, `AppShell.test.jsx`'s "never
  renders an empty `#root`", `client.test.js`'s timeout-message case.
- `LogTab.test.jsx` now pins the restored-list case directly, rather than depending on a mount
  order that no longer holds.
- Full suites green afterwards: 1138 frontend unit tests, 217 e2e, 5 PWA/service-worker.

## What is still not explained, and what will answer it next time

A white screen starting from a **healthy** session — valid token, valid snapshot, plain reload
against a cold backend — was never reproduced, before or after the fix. Every simulation of it
recovered: skeleton until the 15s abort, then cached data, with zero empty-`#root` samples across a
plain reload, an Azure-shaped 503, a double reload, and a real old-SW → new-SW handoff with the
network held 35s.

What *was* observed is that pre-fix, every authenticated boot rendered an empty `#root` for at
least one frame (`SHELL activePersonId=null` in the trace) — `ProtectedRoute`'s stale `hydrated`
let `<Outlet/>` through early, and passive effects flush after paint, so that frame is genuinely
painted. Its duration is bounded by whatever else holds the main thread, which at that exact
instant is the query-cache hydrate, the outbox restore and the cache-warm fan-out. Stretching one
frame to seven seconds on a loaded phone is plausible and **unmeasured**; it is recorded here as a
hypothesis, not a finding. It is closed either way.

So the watchdog now records **why** it fired (`worktrac-boot-failure`, surfaced through Contact Us
into `contact_messages.boot_failure`). The decisive field is `painted`:

| Next recurrence shows | Means |
|---|---|
| `painted: true` + `emptiedAfterMs` | The tree rendered and went away — a component returned nothing, or an unmount past every boundary |
| `painted: false`, no `bundle` mark | The module graph never evaluated — the bundle didn't load, or threw at import time |
| `painted: false`, `bundle` but no `render` | `loadConfig` never settled — the one boot step that blocks `createRoot` |
| `painted: false`, both marks | The throw is inside React's first render |

That is the artifact the 2026-08-31 write-up asked for and could not get. It cannot reach the
server while the backend is down — which is exactly why it is a durable local stash with deferred
delivery, the same principle as the outbox.

## Takeaways

- **An empty `#root` is a failure mode, not a rendering detail.** `return null` from a routed
  component is indistinguishable — to the watchdog, and to the person holding the phone — from a
  crashed boot. Three white-screen reports across five weeks were this.
- **A client timeout shorter than the environment's cold start is not a timeout, it is a scheduled
  failure.** 15s vs a measured 35s meant the first call after every scale-to-zero was guaranteed to
  abort. Measure the environment before choosing the bound.
- **Sign-in must be atomic.** Anything that discards the device's degraded-mode fallbacks has to
  happen *after* the replacement is in hand, never before. Ordering that is invisible on a fast
  network is load-bearing on a slow one.
- **Simulating a hang shorter than the client's own abort proves nothing.** That is why fourteen
  earlier rounds came back clean.
