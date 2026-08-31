# The boot white screen came back — and the first fix's own recovery path didn't help

**Date:** 2026-08-31
**Area:** Frontend — app boot, service-worker update flow, error-boundary recovery UX
**Symptom:** On lower, a person with an already-open, already-authenticated session (on the Log
tab) got the "new version available" prompt, tapped reload, and the app painted then went white.
Reproduced on every subsequent refresh. The only way back in was manually editing the URL bar to
`/login` and signing in again.

## This is a recurrence, not a new bug

`576d1df` (#202, 2026-08-25) added the boot error boundary after an earlier, separately-reported
instance of the exact same shape: "the app painted, then went white a beat later, and a forced
login cleared it." That fix's own commit message was explicit about its limits:

> This does NOT identify what threw. It could not be reproduced: a clean browser loads lower with
> zero console errors, lower's own e2e is green, every deployed asset resolves... What is fixed
> here is that the failure was invisible and unrecoverable, not its cause.

Six days later it recurred, on the same shape, on the same environment, triggered by the same
kind of event (a service-worker update). **The underlying trigger is still not conclusively
identified** — this write-up does not close that question either. What changed is that the
*recovery path* the first fix shipped turned out not to actually recover anything.

## Why the first fix's recovery didn't work

The boot boundary's only action was "Try again" (`ErrorBoundary`'s default fallback), which does
exactly one thing: clear the boundary's own `error` state and re-render the same subtree. For a
throw rooted in axis D (a persisted slice or cached entry from an earlier build hydrating into
something the current code doesn't expect), the restored state that caused the throw is **still
there** — "Try again" hands it straight back to the same code path, which throws again
immediately. Nothing in the recovery path cleared it.

What *did* clear it, per this report and the earlier one: navigating to `/login` and signing in.
`AuthContext.login()` calls `resetQueryCache()` before anything else — the one action in the app
that actually discards the restored TanStack Query cache. Reaching it required knowing to type the
URL by hand, because the crash screen offered no way there.

## Investigation notes, for whoever picks this up next

Backend logs for the affected session (`ContainerAppConsoleLogs_CL`, filtered to the session's
`uid`/`cid`) showed a clean, successful `POST /api/auth/login` and repeated successful
`GET /api/auth/me` — every one returned `200`. So this is **not** a backend, auth, or
`connect-src` CSP problem: if the CSP were blocking the app from reaching the API, those requests
would never have reached the server at all. The asset files (JS, CSS, `config.json`) all served
correctly with the expected headers when checked directly.

The Content-Security-Policy shipped one day earlier (`8dc98ac`, #209) remains a live suspect it
was not possible to rule in or out from here: its own commit message says, in the author's own
words, "DEPLOY THIS ON ITS OWN... It is the one change in this branch that can white-screen the
app... `git revert` this single commit to ship the rest without it" — and because the PR was
squash-merged, that independent-revert plan was never actually available. Its own verification
checklist (`.claude/rules/security-headers.md`) calls for testing on a deployed environment on a
real device, which may not have happened before this report. **The policy has no `report-uri`/
`report-to`**, so a real CSP violation on someone's device is invisible to us by construction —
this is worth closing regardless of whether it turns out to be this bug's cause.

An attempt to reproduce this directly (a fresh account on lower, mobile/WebKit emulation via
Playwright, landing on Log, then reloading) was not completed in this pass — it was blocked by
this environment's own action-permission classifier before it could run against the live
environment. Whoever picks this up with permission to do so should try that first; it is the
fastest path to an actual stack trace instead of another round of inference.

## What this pass actually fixed

Not the root cause — the guarantee that not knowing it no longer matters.

1. **`CriticalErrorFallback`** replaces the default "Try again"-only fallback on the boot boundary
   *and* the route boundary (the one around `<Routes>` — previously it had no custom fallback at
   all). A real `<a href="/login">` is the primary action on both, not merely present.
2. **`frontend/public/boot-watchdog.js`** — deliberately outside the React bundle, a plain script
   that polls whether `#root` has ever painted anything and shows a static "go to login" screen if
   it hasn't. This is the actual answer to "make sure the app never white-screens regardless of
   why": a React error boundary can only catch a render-phase throw within its own subtree. It
   cannot catch a throw inside a `useEffect` (passive, not part of React's render/commit
   try-catch), and it cannot catch anything before React ever calls `render`. Both remained live
   candidates for this exact recurrence, and neither is closed by adding a fourth React boundary.
3. **`config.js`'s `loadConfig()` and the `/config.json` service-worker route are both now bounded
   to 5s** (`AbortController` on the app-side fetch; `networkTimeoutSeconds` on the workbox
   `NetworkFirst` route). Found while confirming this incident's own note above that "the asset
   files... served correctly when checked directly" — true, but a one-off request can only prove a
   file is reachable, not that it can't *hang*. This fetch runs in `main.jsx` before
   `createRoot().render()` is ever called, so nothing — not even `AppShellSkeleton` — paints until
   it settles. It was unbounded at both the app layer and the service-worker layer: a hard-offline
   device rejects this fetch fast and was never at risk, but a connection to *this app's own
   static host* that's merely slow rather than actually failing (a shape nothing else in the app
   watches for — `reachabilityMonitor` only instruments `/api/*` calls) could leave it pending
   indefinitely. Not confirmed as this incident's cause, but a real gap regardless, and directly
   the kind of "flaky connection" condition this write-up was originally trying to rule in or out.

See `.claude/rules/frontend-core.md`'s "Three error boundaries" section for the mechanism items 1
and 2 sit alongside, and `boot-watchdog.js`'s / `config.js`'s own headers for the full reasoning
behind each.

## Follow-up (same day): live-tested against lower, and a real root cause found

Playwright access to lower was granted specifically to chase this further (see this doc's own
note above: "blocked by this environment's own action-permission classifier"). Seven rounds of
live testing followed, against the deployed lower environment rather than a local simulation.

**Rounds 1-4 (simulating a cold/hanging backend, staggered recovery, Chromium and WebKit/mobile
emulation, `page.reload()`) never reproduced anything.** The app handled every shape of
cold-backend hang gracefully — cached data stayed visible, the outbox queued correctly, no
fallback ever fired. This ruled out both "the backend being cold" and "the browser engine" as the
trigger on their own.

**Round 5's theory, read directly out of `config.js`, was that item 3 above (the 5s
`/config.json` timeout) doesn't just avoid a hang — its *fallback* is the actual bug.**
`loadConfig()`'s catch block set `config = { apiUrl: '' }`. `getApiUrl()` treats an empty
`apiUrl` as "use relative paths" — correct in local dev, where the Vite proxy makes
`/api/...` resolve to the real backend. **In every deployed environment there is no such proxy**
(`staticwebapp.config.json` has no backend link at all — only the absolute `apiUrl` this very
fetch is trying to read). So once this fallback fires, every subsequent API call for the rest of
that page's life — login included — targets the frontend's *own* static-hosting origin instead of
the backend, which has no `/api/*` route and answers with a real, fulfilled 404/405. That's not an
offline-shaped failure (`isOfflineError()` only classifies no-status-or-5xx that way), so **none**
of the app's degraded-conditions machinery — the outbox, `AuthContext`'s snapshot fallback,
`isOfflineError` — ever engages. It just fails, quietly, against the wrong host, until the person
happens to get a fully successful reload.

Testing this directly took two false starts before it actually proved anything, both worth
recording because the same trap is easy to fall into again:

- **`page.route('**/config.json', hang)` looked like it disproved the theory** (rounds 5-6): every
  subsequent request still hit the correct backend origin, even with `/config.json` forced to hang
  past its 5s timeout. The reason wasn't that the app was fine — it was that **`page.route` does
  not intercept a service worker's own internal `fetch()` calls**, only requests the page's JS
  issues directly. Once a service worker is installed and controlling (true for anything but a
  literal first-ever navigation), workbox's `NetworkFirst` strategy runs *inside the SW's own
  execution context*, invisible to page-level routing — so the "hang" silently no-opped on every
  navigation after the very first.
- **Round 7 switched to `context.route`**, which does cover service-worker-mediated requests, and
  re-ran the first-ever-load scenario. This time `configHits` was `1` (proving the interception
  was real) and the result flipped completely: a login form submitted on the same, still-loaded
  page sent its `POST` to `https://app.dev.huddle.fitness/api/auth/login` — the frontend's *own*
  origin — and got back a `405`. **Confirmed, reproducible, live**: the theory was right, the
  first test of it was a false negative from a Playwright tooling gap, not evidence against it.

This explains both halves of this report. The initial crash: a service-worker-triggered reload is
by definition the device's first navigation under the *new* SW version, and if `/config.json`'s
fetch is slow or fails for any reason during that one window (plausible on the mobile connection
this was reported on), the fallback poisons the rest of that page's life, and whatever the app's
bootstrap `/api/auth/me` call gets back from the wrong origin is not a shape any code downstream
expects. The "logged in but no data" half: clicking the crash screen's "Go to login" link is a
real, hard navigation (`CriticalErrorFallback` uses `<a href>`, not client-side routing — see
`frontend-core.md`), so it gets its own fresh `/config.json` attempt; if the same degraded
connection caused a second failure there too, login itself would 404 rather than merely showing no
data afterward — so the two halves are likely the *same* mechanism catching the device on two
separate, nearby moments of a connection that was bad for more than an instant, not one mechanism
explaining both symptoms end to end. That residual gap is honest, not resolved — see below.

### The fix

`config.js` now remembers the last successfully-fetched `apiUrl` in `localStorage`
(`worktrac-last-known-api-url`) and falls back to *that* on any failure — a rejection, a timeout,
or a non-2xx response — rather than to an empty/relative one. For a returning user (i.e. anyone
who has loaded the app successfully even once before, which is everyone this bug was reported
against), that value is correct with effective certainty: it changes only if this environment's
backend is redeployed to a new hostname, which has never happened and would itself ship alongside
a new frontend deploy. Only a device that has *genuinely* never loaded the app before still falls
through to the empty/relative fallback — the same behavior local dev's own `config.json`
(`apiUrl: ""`) already relies on.

Verified non-vacuous: reverting the fallback to the old `{ apiUrl: '' }` while keeping the new
tests fails exactly the two tests that assert the last-known-apiUrl behavior, confirming they'd
catch a regression back to this bug.

### What's still open

The connection-quality trigger itself — *why* `/config.json` failed on the specific device/moment
this was reported from — is still not something this pass reproduced from first principles; it
was reproduced by deliberately forcing the failure, not by finding what caused a real one. A
mobile connection degrading for a few seconds right after a fresh deploy (exactly when a
service-worker update prompt appears) remains the leading, plausible explanation, consistent with
every detail in the original report, but "plausible and consistent" is not the same standard as
the axis-A/B/C/D reproductions elsewhere in this document, and should be labeled as such if this
is revisited.

## Also found, not yet fixed

`AppShell`'s chrome — `Header` (which now renders the Pro/billing badge), `PersonPillBar`,
`SessionBar`, `TabsNav`, and AppShell's own ~10 `useEffect`s reading persisted rest-timer/person
state — sits **outside** the tab-panel boundary, which wraps only `<Outlet/>`. A throw there
already escalates past the tab boundary's "keep navigation alive" recovery to the route boundary
(now at least showing `CriticalErrorFallback` rather than nothing, per this fix) — but the whole
shell goes down for what might be one component. Not addressed here: it's a real structural gap,
but touching AppShell's chrome carries real risk to the sticky-chrome layout rules documented
elsewhere in `frontend-core.md`, and this pass was scoped to guaranteeing a way out, not to
minimizing blast radius. Worth a dedicated pass.
