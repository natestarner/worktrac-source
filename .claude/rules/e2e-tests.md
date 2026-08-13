---
paths:
  - "e2e/**"
---

# E2E (Playwright) rules

Full narrative: `docs/architecture/testing.md`.

## Running

- **Never run `npx playwright test` directly — always `bash scripts/e2e.sh`.** Raw Playwright
  defaults to `http://localhost:3000`, which for any worktree other than the primary `main`
  checkout is either nothing or **a sibling session's stack**, and it has no idea when the dev
  server dies mid-run. Both failure modes present as a screenful of unrelated red specs that read
  like a code regression; chasing one of them as such cost about an hour on 2026-08-09.
- Prefer **two separate shell invocations** for a full suite — `bash scripts/up.sh`, then
  `bash scripts/e2e.sh`. The Vite dev server has a known habit of dying partway through a long
  run, and the one surviving correlation is up.sh sharing an invocation with the run (see the
  `KNOWN UNRESOLVED` block in `scripts/up.sh`). e2e.sh warns when it had to start the stack itself.
- `bash scripts/e2e.sh` runs the suite against **this worktree's own stack**. It **reuses** that
  stack when it's already serving, and otherwise brings it up via `scripts/up.sh` — which is
  **readiness-gated**, so it doesn't return until both ports actually answer (and exits non-zero,
  dumping the relevant `.dev-logs/` tail, if they don't).
- **Before believing any failure**, check whether e2e.sh printed its "⚠️ The frontend/backend died
  during this run" banner. If it did, the results above it are meaningless. The `[[<name> exited
  rc=...]]` line it points at answers the next question: present = the server exited on its own
  (rc says why); absent = something killed it.
- **The backend does not hot-reload.** A reused stack still serves the code it booted with, so pass
  `--restart` (or `E2E_RESTART=1`) after changing backend code. Vite hot-reloads, so frontend edits
  need nothing.
- Locally, Playwright auto-detects ~11 workers vs CI's fixed 2, which overwhelms a single local
  backend. Rerun a failure with `--workers=2` before treating it as real — and if it still fails,
  try `--workers=1` before believing it, since a couple of specs are contention-sensitive.
- **Invoke `scripts/e2e.sh` by RELATIVE path from the worktree you mean.** An absolute path to
  another checkout's copy runs *that* tree's specs and `node_modules` against *this* worktree's
  ports and database — `worktree-env.sh` answers "which repo" from `$PWD` while each script answers
  from its own location. It presents as the stack-death signature below, so it disguises itself as
  the very thing you're about to rule out. `worktree-env.sh` now refuses this, but only for trees
  that already carry that guard.
- **Scattered failures across unrelated specs — especially if `smoke.spec.ts` is among them — mean
  the stack, not the code.** Check `.dev-logs/frontend.log` for
  `http proxy error … ECONNREFUSED` (backend wasn't up) and confirm both ports answer before
  reading anything into the results. `up.sh` used to return before the stack was listening, which
  produced exactly this signature; the readiness gate above is what closed it.
- **A dev server that dies mid-run has two known causes, one fixed and one not.**
  1. *Fixed:* a sibling worktree. `up.sh`/`down.sh` act by port, so two worktrees sharing ports
     kill each other's stacks. `worktree-env.sh` now refuses to allocate a port another
     worktree's `.env.worktree` has claimed and warns on a pre-existing overlap — **heed that
     warning**: delete the offending `.env.worktree` and re-run to move onto free ports.
  2. *Not reproduced since:* Vite was dying partway through long runs, silently, with nothing in
     its log. Ruled out at the time: OOM, the dev proxy, a spec killing processes. It has **not
     recurred** across repeated full runs since the port deconfliction landed *and* the concurrent
     session that had been running its own stack throughout finished — consistent with cause 1,
     though never proven for those specific deaths. `setsid` is **absent from stock
     Git-for-Windows bash**, so `up.sh` warns and falls back to `nohup`; a PowerShell
     `Start-Process` launcher was tried as a substitute and reverted (couldn't be shown to start
     the backend reliably).

     **You will not have to guess if it happens again.** `up.sh` wraps each server so its exit is
     recorded in its own log, and `e2e.sh` checks both ports *after* the run:
     - `[[frontend exited rc=N ...]]` present → it exited on its own; `rc` and the lines above say why.
     - Line absent and the process is gone → something killed it (SIGKILL leaves no trace); suspect
       another worktree or an external `taskkill`.

     `e2e.sh` fails the run with a loud message in that case, so a mid-run death can never again be
     mistaken for a batch of code regressions.
- Service-worker-dependent specs (cold boot, reload-while-offline) live in
  `offline-durability.spec.ts` and run **only** via `cd e2e && npm run test:pwa`
  (`playwright.pwa.config.ts`, which builds + previews on port 3000 — needed for local CORS, since
  `vite preview`'s proxy forwards the browser's real `Origin`). They're excluded from the fast
  default project.

## Connectivity helpers — use these, not ad hoc calls

`tests/support/offline.ts` (banner/outbox locators, `goHardOffline`/`goOnline`) and
`tests/support/faults.ts`:

- **`failNetwork`** — a rejected fetch. The **only** thing that drives lie-fi detection.
- **`failWithStatus`** — fulfils a real 4xx/5xx, so the server "answered" and the
  consecutive-failure counter resets. Does **not** trip lie-fi.

`context.setOffline()` cannot drive lie-fi at all — it needs request-level fault injection.

## Parity specs: one assertion body, every connectivity mode

`tests/support/parity.ts`'s **`forEachConnectivityMode`** emits one test per mode (online,
lie-fi, hard-offline, pinned-offline) from a single spec, so "this behaves the same regardless of
connectivity" is a test result rather than a comment. Use it for any user-visible flow.

Phases, in order — `setup` runs **online**, everything after runs **in the mode**:

| Phase | Runs | For |
|---|---|---|
| `setup(page, request)` | online | `registerHousehold`, server-side seeding. Returns state passed to every later phase |
| `navigate(page, state, ctx)` | in-mode | Screen navigation. **Not `setup`** — entering pinned-offline routes through App Settings, so `setup`'s screen is gone |
| `act` / `assert` | in-mode | The action, then the parity claim |
| `afterReconnect` | after restore + outbox drain | That the write actually reached the server |

- **`assert` must not branch on `ctx.mode`.** If it needs to, that is a real divergence and belongs
  on the register in `.claude/rules/resilience.md`, not in an `if`.
- **Assert the *result*, not the sync chrome.** The outbox badge, "Saving…" and the offline banner
  legitimately differ by mode — those belong in `offline-outbox` / `offline-mode` /
  `intermittent-errors`, not a parity spec.
- **`pinned-offline` is arranged via the App Settings toggle** (`pinOfflineViaSettings`), not the
  trouble banner, because the banner needs three consecutive request failures to appear — i.e. a
  write, the very thing under test. The banner's own path stays covered by `intermittent-errors`
  and `connectivity-transitions`.
- **A parity test that could pass vacuously guards nothing.** Verify a new one fails when you break
  a single mode, before trusting it.
- **A retrying matcher cannot assert "this was never shown".** `toHaveValue('')` and friends poll
  until they pass, so a wrong value that self-corrects is simply waited out. The exercise-switch
  parity spec passed against the unfixed code for exactly this reason; it now samples the field on
  every animation frame and asserts the bad value was never among them. Reach for frame sampling
  whenever the claim is about a transient rather than a settled state — it also needs no per-mode
  timing knowledge, which a short fixed timeout would.
- **Verify in every mode, not just the degraded ones.** A stale-paint bug can be invisible
  offline (where `derivedSummary` resolves synchronously from the warmed cache) and very visible
  online (where it lasts a round trip). Checking only the offline modes would have concluded there
  was no bug.
- **`waitForOutboxDrain` is the only sanctioned "the write reached the server" gate, and the banner
  count alone is not one.** `useOutboxCount` stops counting a write once it is a plain in-flight
  first attempt, which also fires the instant a paused write resumes — so gating on the banner text
  by hand lets a reload land with the write still in the outbox, and whatever renders next came from
  `restoreOutbox`'s replay, not the server. That made three of four parity modes pass vacuously
  (`docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md`).
- **A `fixmeModes` entry is a hypothesis, not a diagnosis.** Recording a found divergence instead of
  blind-patching is right, but confirm the reproduction measures what it claims before reasoning
  from *which* modes it names — the 2026-08-12 entry's mode list was an artifact of how long each
  mode's run happened to take relative to the persister's 1s throttle.

## ⚠️ Cross-file coupling: the test email pattern

`tests/support/auth.ts`'s `registerHousehold` generates
`huddle+e2e-<timestamp>-<random>@starner.co`. The backend's `TestDataCleanupService`
(`CURRENT_EMAIL_PATTERN` = `huddle+%@starner.co`, `LEGACY_EMAIL_PATTERN` = `e2e-%@example.com`)
holds **independently-maintained copies of that literal** — they are not derived from a shared
constant. **They must always change together.**

Switched from `e2e-<...>@example.com` on 2026-08-02: that IANA-reserved domain could never resolve,
so every e2e registration bounced and counted against the sending domain's ACS reputation.

- `EmailProperties.e2eNoopRecipientPattern` (set only in local/lower, inert in production) makes
  `EmailService.send()` skip the real ACS call for addresses matching the **`huddle+e2e-` prefix**,
  returning a synthetic `"noop-<uuid>"` messageId. Everything above that one network call still
  runs for real, so the send is still fully visible in the audit trail.
- **`live-email-canary.spec.ts` is the one spec that triggers a real ACS send** — its
  `huddle+livewiretest-...` address deliberately falls outside the no-op pattern. It can't just
  assert the UI reached `/app/log` (the code is cached synchronously, independent of the async
  send); it polls `GET /api/auth/test/email-outcome` to read the real
  `VERIFICATION_EMAIL_SENT`/`FAILED` event back.
- `registerHousehold`'s optional `emailOverride` exists for that spec only — **every other call
  site keeps the default-generated address**.

## Never drive the weight/reps steppers by hand — use `logSetAt`

**The race this used to guard against is fixed in the app** (2026-08-12): the draft is stamped
`source: 'user'` once typed, and only an exercise change or a set actually being added may re-seed
over it, so a settling summary can no longer stomp a typed value between `setStepper` and the "Log
set" click. `logSetAt`'s polling is now **defensive, not load-bearing**.

It stays the sanctioned helper anyway — **don't hand-roll stepper driving and don't reintroduce a
spec-local copy.** It still commits both fields together and waits for the new `Set N` row before
returning, which keeps specs deterministic, and it is the single place to change if this ever
regresses.

The history is worth knowing, because it is how a product bug hid inside test infrastructure for
four days: `computePrefillDraft` re-seeded whenever the summary / today's sets changed, which could
land after `setStepper` verified its value and before the click, logging the set at the prefill
instead of the target. Locally the queries return in milliseconds so the race was almost never
lost — a full green local suite, red only against a deployed backend, which is how it took lower
red on 2026-08-08. It surfaced **somewhere other than where it went wrong**: a 315×2 deadlift
logged as 0×2 is no longer a PR, so what you saw was a missing "New PR!" celebration.

**A helper that polls around a product behaviour is a bug report.** File it against the app rather
than hardening the helper and moving on. See
`docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md`.

**A spec that logs at the prefill without setting a weight is logging a *bodyweight* set** (weight
0), because `comparableLb` switches to comparing reps at zero. That is fine where the number is
incidental (`parity-active-loop`) and wrong where it isn't — `offline-reads` sets 45 explicitly for
exactly this reason. Decide which you are before leaning on the default.

`support/exercises.ts`'s **`logSetAt`** is the only sanctioned way to log a set at a specific
weight/reps. It re-verifies both steppers together before submitting (a re-seed stomps both, so a
drifted reps value also catches a drifted weight) and waits for the new `Set N` row afterwards, so
the re-seed that write triggers has fired before the next call types anything. **Don't call
`setStepper` directly to log a set**, and don't reintroduce a spec-local copy of this helper.

## Locator gotchas

- **Use `exact: true` with `getByText`.** Toast and confirm-dialog text embeds item names, so
  substring matches collide and throw strict-mode violations.
- New visible UI text that repeats an existing name (e.g. a link containing an exercise name) can
  break unrelated specs elsewhere on the same screen. Put the repeated name in an `aria-label`,
  not visible text.
- `new RegExp(email)` breaks on the `+` in `huddle+e2e-...` addresses — escape it.

## Cleanup

A global teardown (`tests/support/globalTeardown.ts`) calls `DELETE /api/admin/test-data` after
every **local** run. It's deliberately a no-op against any non-`localhost` `baseURL`, and never
fails the run — cleanup is hygiene, not a correctness gate.
