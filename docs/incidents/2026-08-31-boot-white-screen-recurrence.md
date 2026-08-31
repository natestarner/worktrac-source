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

See `.claude/rules/frontend-core.md`'s "Three error boundaries" section for the mechanism this
sits alongside, and `boot-watchdog.js`'s own header for the full reasoning behind the watchdog
specifically.

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
