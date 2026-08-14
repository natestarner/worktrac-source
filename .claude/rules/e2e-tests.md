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
- **Do not "rerun it at `--workers=1`" to decide whether a failure is real.** That ritual used to
  be the standing advice here and it was answering the wrong question — see
  `docs/incidents/2026-08-13-e2e-parallel-flakiness.md`. Two of the four things making the suite
  flaky scaled with *run duration* or *machine load*, not with test independence, so `--workers=1`
  "fixing" a failure was never evidence of a parallelism bug. Every spec is independent by
  construction (own household, own context, account-scoped schema). Read the failure instead.
- **Scale parallelism with `E2E_WORKERS=<n>`, not `--workers`.** Both work — `playwright.config.ts`
  reads the CLI flag too — but `E2E_WORKERS` is the documented knob, and the per-test/assertion
  time budgets are derived from whichever one you use, so the budget always matches the contention.
  The local default is `cores/4` (capped at 8), deliberately below Playwright's own `cores/2` so a
  sibling worktree's suite still has room; a deployed target is pinned at 2 regardless.
- **The local stack is configured to absorb that parallelism — don't undo it.** `scripts/db.sh`
  sets `READ_COMMITTED_SNAPSHOT ON` (Azure SQL's default, a SQL Server container's non-default;
  without it `logLiveSet` deadlocks against itself under concurrency), `application-local.yml`
  sizes HikariCP at 40 and lifts the registration rate limits far above suite volume, and
  `show-sql` is off by default (`SHOW_SQL=true` to opt back in).
- **An overloaded local backend does not present as "slow" — it presents as "offline".** A
  saturated pool queues requests past `api/client.js`'s 15s `REQUEST_TIMEOUT_MS`, and an aborted
  fetch is a *rejected* fetch, which is the one thing that trips lie-fi detection. So a spec that
  arranged "online" can fail asserting connectivity chrome it never asked for. If a connectivity
  assertion fails in a spec that isn't about connectivity, suspect load before suspecting the app.
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
  2. *Still open, but no longer a mystery about WHICH server:* Vite dies partway through long
     runs, silently, with nothing in its log. Ruled out earlier: OOM, the dev proxy, a spec killing
     processes. `setsid` is **absent from stock Git-for-Windows bash**, so `up.sh` warns and falls
     back to `nohup`; a PowerShell `Start-Process` launcher was tried as a substitute and reverted
     (couldn't be shown to start the backend reliably).

     **2026-08-13 — it is ALWAYS the frontend, never the backend.** Across repeated full-suite
     runs that failed this way, every single one ended `backend=UP frontend=DOWN` (probed live,
     before and after each run). Don't spend time suspecting the backend.

     **The exit marker below is now trustworthy; before 2026-08-13 it was not.** `up.sh` opened
     these logs with `>`, so the restart that `e2e.sh` performs after a death truncated the very
     marker written by that death — guaranteed, every time, because `e2e.sh` auto-restarts a dead
     stack. The marker had never actually been read, and "no marker, so it was killed" was
     concluded from a log written *after* the event. `up.sh` now appends with a per-start banner
     and `e2e.sh` scopes its search to the last session, so **exit-vs-killed is an open question
     the next occurrence will answer** — read it, don't assume it.

     A hypothesis for the frontend/backend asymmetry, to be checked against that marker rather
     than assumed: without `setsid` both servers stay in the invoking shell's process group, but
     `mvn spring-boot:run` forks a separate JVM (a detached grandchild that outlives a
     process-group teardown) while `npm run dev` leaves Vite a direct descendant. If the next
     death carries an `rc`, this is wrong and the lines above it hold the answer.

     It is **load-dependent, not deterministic**: the same stack survived several full runs and
     then died three in a row, and the surviving runs were the fastest. Concurrent CPU load
     (another suite, a lint, a vitest run) makes it markedly more likely — so **don't run
     anything else while a full suite is going**, and re-run a death before reading anything
     into the results.

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

## Flakiness — where the record lives

- **E2E never runs in this repo's CI.** `ci.yml` is `backend-ci` + `frontend-ci` only. The suite
  runs in GitHub in exactly one place: `worktrac-deploy`'s `deploy-lower.yml`, job `e2e-tests`,
  on push to `lower`. Locally it runs via `scripts/e2e.sh`. There is nowhere else to look.
- **A green lower run is not evidence the suite is stable.** CI sets `retries: 2`, so a test that
  fails and then passes is recorded `flaky` while the run still reports success — the run-level
  conclusion carries no flake signal at all. Measured 2026-08-14 across the 51 runs then retained:
  **42 were green, and 38 of those 42 contained at least one flaky test.** Do not infer "the suite
  is fine" from a row of green checks.
- **Per-test outcomes come from the `e2e-results-json` artifact** (`results.json`, written by the
  `json` reporter — see `playwright.config.ts`). Read `stats.flaky` for the run, and each test's
  `status` / `retry` for which ones. `outcome: flaky` means "needed a retry", `unexpected` means
  "failed all attempts".
- **Don't scrape `playwright-report/index.html`.** The same data is in there, but only as a
  base64'd zip in an internal format with no compatibility promise. That is what had to be done
  before the `json` reporter existed; it is not the supported path.
- **Artifacts expire.** Once they do, that history is unrecoverable — there is no other copy. If
  you are investigating a flake, pull the artifacts you need *first*, before they age out.
- **Attribute before fixing.** Lower is shared and deploys queue, so a failure in a given run may
  belong to an earlier-queued merge — and the job checks out this repo's default branch unpinned,
  so the specs that ran can be newer than the image they ran against. See the attribution protocol
  in `.claude/commands/deploy-to-lower.md`.

## Connectivity helpers — use these, not ad hoc calls

`tests/support/offline.ts` (banner/outbox locators, `goHardOffline`/`goOnline`) and
`tests/support/faults.ts`:

- **`failNetwork`** — a rejected fetch. The **only** thing that drives lie-fi detection.
- **`failWithStatus`** — fulfils a real 4xx/5xx, so the server "answered" and the
  consecutive-failure counter resets. Does **not** trip lie-fi.

`context.setOffline()` cannot drive lie-fi at all — it needs request-level fault injection.

### `setOffline` does NOT survive into a document created after it

Measured 2026-08-14, both sides of one reload:

| Document | `navigator.onLine` | Event |
|---|---|---|
| Live, right after `setOffline(true)` | `false` | `offline` fired |
| Created by the reload that follows | **`true`, forever** | none |

CDP's `Network.emulateNetworkConditions` flips the renderer's network state and fires the
transition on documents that **already exist**; a document created afterwards starts life reading
`true`, and since nothing transitioned there is no event to correct it. Requests still genuinely
fail — so **a spec that reloads while offline is testing lie-fi, not hard offline**, and the app
correctly shows the connection-trouble banner rather than the offline one.

**Reloading while offline? Use `keepHardOfflineAcrossReload(page)`** (`support/offline.ts`)
alongside `setOffline(true)`. It pins `navigator.onLine` false for later documents, which is what a
genuinely offline device reports and what `applyPersistedPin()` seeds `onlineManager` from. It
**cannot be undone**, so don't use it in a spec that reconnects and reloads again.

This cost four days: the cold-boot spec was recorded as a known pre-existing failure, then
diagnosed a second time as a product bug in `offlineMode.js` — a coherent theory that fit every
piece of static evidence and was refuted by twenty seconds of in-page measurement. **Probe the
harness with `addInitScript` before concluding the app is wrong.** See
`docs/incidents/2026-08-14-cold-boot-offline-spec-measured-liefi.md`.

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
