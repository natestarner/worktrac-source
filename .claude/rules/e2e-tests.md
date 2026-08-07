---
paths:
  - "e2e/**"
---

# E2E (Playwright) rules

Full narrative: `docs/architecture/testing.md`.

## Running

- `bash scripts/e2e.sh` runs the suite against **this worktree's own stack**. It **reuses** that
  stack when it's already serving, and otherwise brings it up via `scripts/up.sh` — which is
  **readiness-gated**, so it doesn't return until both ports actually answer (and exits non-zero,
  dumping the relevant `.dev-logs/` tail, if they don't).
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
- **A dev server that dies mid-run is almost certainly a sibling worktree, not a crash.**
  `up.sh`/`down.sh` act by port, so two worktrees sharing ports kill each other's stacks — which
  reads as the Vite dev server silently vanishing with nothing in its log. `worktree-env.sh` now
  refuses to allocate a port another worktree's `.env.worktree` has claimed and warns on a
  pre-existing overlap, but **heed that warning** rather than working around it: delete the
  offending `.env.worktree` and re-run to move onto free ports. `git worktree list` plus a quick
  scan of each `.env.worktree` shows who owns what.
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
