---
description: Spin up this worktree's own isolated local dev stack (shared SQL Server container + this worktree's own database, backend, frontend) so the app can be exercised in a browser. Safe to run alongside other worktrees' stacks -- each gets its own ports/database. Also the way to restart a stale local run for this worktree. Use when the user says "run it locally", "run in local", "spin up local dev", "start the app locally", "test this in local", or similar.
---

# /run-local

Get the app running locally so the user can open it in a browser and click around. Run
**fully autonomously** through the steps below — don't ask for confirmation, this only
touches local processes and a local Docker container, nothing shared or remote.

## Facts this relies on (see `CLAUDE.md` and `docs/DEVELOPMENT.md`)

- Every worktree gets its **own backend port, frontend port, and database**, derived
  deterministically from the worktree's branch name (`scripts/worktree-env.sh`). The primary
  `main` worktree always gets the historical **3000/8080/`worktrac`**; every other worktree
  gets its own ports in the 3001+/8081+ ranges and its own `worktrac_<slug>` database, picked
  the first time `scripts/up.sh` runs there and then reused. This means **running `/run-local`
  in two different worktrees at the same time is safe** — they will not collide.
- All worktrees share **one** SQL Server container (`worktrac-sqlserver`, host port 1434) —
  isolation between worktrees comes from each having its own *database* on that one server,
  not from separate containers. A *different* project's container, `inttime-sqlserver`, also
  runs on this machine on the standard port **1433** — never stop, start, or otherwise touch
  that one.
- `mvn spring-boot:run` forks a separate `java` process and `npm run dev` forks a separate
  `node`/vite process; both outlive their launching shell if it's killed. `scripts/down.sh`
  (called by `scripts/up.sh` before it starts anything) frees a port by killing whatever
  process is actually bound to it, found via `netstat` — never by image name, and never a
  port belonging to another worktree.
- **The Stripe webhook listener is the one exception to "each worktree gets its own" — only ONE
  may run at a time, machine-wide.** `stripe listen` receives every event on the Stripe account
  regardless of its own `--forward-to` target, so two worktrees each running one would both
  receive events meant for the other's checkout — and the webhook handler resolves the target
  account from a small local id that different worktree databases routinely reuse (both commonly
  have an account #1). `scripts/stripe-listen.sh` tracks ownership in one file shared by every
  worktree of this repo (the git common dir) and safely takes over from whichever worktree
  currently holds it; see that script's header for the full reasoning.

## Steps

### 1. Find the repo root
`REPO_ROOT=$(git rev-parse --show-toplevel)` — run this from wherever the session currently
is (main checkout or any worktree); it returns *that* worktree's own root.

### 2. Load Stripe credentials, start the webhook listener, then the stack -- in ONE command
```bash
cd "$REPO_ROOT"
if [ -f "$HOME/.huddle-stripe-env" ]; then
  source "$HOME/.huddle-stripe-env"
fi
eval "$(bash scripts/stripe-listen.sh)"
bash scripts/up.sh
```
All of this must run in the **same** Bash tool call — shell state (exported vars) does not
persist between separate calls, so splitting these across two calls silently loses every export
below and billing quietly falls back to its honest-503 default.

- `~/.huddle-stripe-env` holds this user's real Stripe **sandbox** credentials
  (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`)
  as `export` lines — never committed, never read by anything except this step, sourced only if
  present so a machine without it still runs the rest of `/run-local` normally.
- `stripe-listen.sh` then mints a **fresh** webhook signing secret and prints
  `export STRIPE_WEBHOOK_SECRET=whsec_...` to stdout (nothing, if the Stripe CLI isn't installed
  or isn't logged in — a silent no-op, not a failure); its value deliberately overrides whatever
  `~/.huddle-stripe-env` might also carry for that one variable, since a webhook secret is only
  ever valid for the `stripe listen` session that minted it. See that script's header for why
  only one may run at a time, machine-wide, and how it safely takes over from another worktree.

Run this via the Bash tool with `run_in_background: true` — `up.sh` backgrounds the backend and
frontend itself and returns immediately after kicking both off. It prints which ports and
database this worktree is using; note them for the next step. It's safe to re-run any time,
including while a previous run's servers (for this same worktree) are still up.

With `~/.huddle-stripe-env` absent and the Stripe CLI not logged in, billing still degrades to an
honest 503 (comped/test-support Pro, per the seed step below, needs none of this) — this step is
additive, not a new requirement for the rest of `/run-local` to work.

### 3. Poll for readiness
Using the ports `scripts/up.sh` printed:
- Backend: poll `http://localhost:<BACKEND_PORT>/actuator/health` (or tail
  `.dev-logs/backend.log` for `Started BackendApplication`) — allow up to ~90s on a cold Maven
  dependency resolution.
- Frontend: poll `http://localhost:<FRONTEND_PORT>` (or tail `.dev-logs/frontend.log` for
  `ready in`). **Confirm the log's `Local:` line matches the expected port** — if it doesn't,
  something is still holding that port; check `bash scripts/status.sh` rather than continuing
  on the wrong port.

If either fails to come up, read its log under `.dev-logs/` and report the actual error rather
than retrying blindly.

### 4. Seed the standing test household
```bash
node scripts/seed-local-account.mjs
```
Run once both ports actually answer. Registers `nate@starner.co` (bypassing the real inbox via
`TestSupportController`, only in `local`/`lower`), grants it Pro, and imports several weeks of
synthetic history through the real CSV import endpoint — but **only the first time**, on the run
that just created the account. On every later `/run-local` for this same worktree it finds the
account already there (the database persists across `up.sh` restarts) and does nothing but
confirm Pro. This is what lets local testing start from an account with real history already in
it instead of a blank registration every time.

Never fails the overall command: the script itself warns and exits 0 on any problem, so a hiccup
here is worth mentioning to the user but is not a reason to report `/run-local` as failed.

### 5. Report readiness
Tell the user (using this worktree's actual ports):
- Frontend: `http://localhost:<FRONTEND_PORT>`
- Backend health: `http://localhost:<BACKEND_PORT>/actuator/health`
- Database: `<DB_NAME>` on the shared `worktrac-sqlserver` container (port 1434)
- The seeded login: `nate@starner.co` / `password`
- Whether the Stripe webhook listener came up (check `.dev-logs/stripe-listen.log`, or whether
  step 2's `eval` line was non-empty) — mention it either way, since "billing checkout works but
  webhooks silently don't land" is confusing to debug later if it's skipped without being said.

Leave both dev servers running in the background — that's the point, so the user can use the
app. Don't tear them down at the end of this command; use `/stop-local` for that.

## Notes

- Local dev has no hot-reload for new/changed backend endpoints — if the user edits backend
  code after this command finishes, re-run `/run-local` (or at least restart the backend) to
  pick the change up.
- This command only starts the app for manual browsing. It does not run the test suites or
  Playwright e2e — for that, see `mvn verify`, `npm test`, and `scripts/e2e.sh` /
  `.claude/commands/deploy-to-lower.md`.
- `bash scripts/doctor.sh` and `bash scripts/status.sh` are useful for diagnosing "why didn't
  this come up" without re-running the whole stack.
- The seeded household is real data in this worktree's own database, not a fixture reset on every
  run — deleting or editing it locally is fine and simply won't be recreated (the seed script only
  acts when `nate@starner.co` doesn't exist yet). `bash scripts/db-reset.sh` (a fresh database) is
  what brings the seed back on the next `/run-local`.
- `scripts/stripe-listen.sh` is independent of `up.sh`/`down.sh` and never touches their process
  detection. Because only one may run at a time machine-wide, its ownership lives in one file
  shared by every worktree (the git common dir), not this worktree's own `.dev-logs/` — see its
  header. `/stop-local` stops it, but only if THIS worktree currently owns it; if a sibling
  worktree took it over since, `/stop-local` here correctly leaves it running for them.
  `bash scripts/stripe-listen.sh` alone (re-)takes ownership for this worktree without touching
  the rest of the stack.
