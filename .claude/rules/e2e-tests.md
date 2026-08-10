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

`computePrefillDraft` re-seeds the weight/reps draft whenever the summary / session-sets queries
settle, which can land **after** `setStepper` has verified the value it typed but **before** the
"Log set" click. The set is then logged at the 45 lb prefill default instead of the target.

Locally those queries return in milliseconds and the race is almost never lost, so this passes a
full local suite and goes red only against a deployed backend — it took lower red exactly that way
on 2026-08-08, having been green across several local runs first. It also surfaces **somewhere
other than where it went wrong**: a 315×2 deadlift logged as 45×2 is no longer a PR, so what you
see is a missing "New PR!" celebration, or a records/sort assertion reading a number nobody typed.

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
