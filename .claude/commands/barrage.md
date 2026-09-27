---
description: Run the barrage -- the full pressure test of History, offline, sync and load against lower (or a local stack) with years of data -- and report what it found. Use when the user says "barrage", "run the barrage", "stress test lower", "pressure test", "hammer lower", "attack/storm the app", or asks for the exhaustive lower testing before a production deploy. Optional argument: quick | standard | full (default quick), or "watch" to run through the next lower deploy.
---

# /barrage

Runs `e2e/barrage/barrage.mjs` and turns its report into an answer the user can act on. The tool
and everything it checks are documented in `e2e/barrage/README.md` -- read it first if you haven't
this session. Run **autonomously** once started. It only reads and writes a dedicated test account on
lower, reads lower's logs and metrics, and runs local processes in this worktree.

## 1. Pick the tier

From the argument or the user's words:

| Asked for | Run |
|---|---|
| nothing, "quick", "smoke" | `--tier quick` (~20 min) |
| "standard", "normal", or WebKit/Safari mentioned | `--tier standard` (~1 h) |
| "full", "everything", "exhaustive", "before production" | `--tier full` (~2-3 h) |
| "watch the deploy", "during the deploy" | `--watch-deploy` (see step 5) |
| a specific area ("just the offline stuff") | `--suites ...` / `--only ...` from the README's tables |

## 2. Credentials (lower)

The tool reads `BARRAGE_EMAIL` / `BARRAGE_PASSWORD` from the environment or
`~/.worktrac/barrage.env`. Check the file exists (don't print its contents).

- If it doesn't exist, **ask the user** for the dedicated lower test account.
- Pass the credentials as environment variables on the command only.
- **Never write them into the repo, a commit, memory, or a report.** Offer to create
  `~/.worktrac/barrage.env` for them (outside the repo) so future runs don't ask.

If the run stops with "the lower account holds N workouts", ask before re-running with `--seed`: it
imports five years of History into that account.

## 3. Local pieces (full tier, or `--target local`)

`compare` and `--target local` need **this worktree's** backend running and its **dev frontend
stopped**, because the barrage serves production builds on that port itself. It is the same dance
as the PWA suite in `/deploy-to-lower`:

```bash
bash scripts/up.sh                                             # its own call
FE=$(grep FRONTEND_PORT .env.worktree | cut -d= -f2)           # primary checkout: 3000
PID=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort $FE -State Listen -ErrorAction SilentlyContinue).OwningProcess" | tr -d '\r' | head -1)
powershell.exe -NoProfile -Command "Stop-Process -Id $PID -Force"
```

Don't use `down.sh` for this (it stops the backend too). If the local stack can't be brought up,
run the tier anyway: `compare` records a SKIP rather than failing.

## 4. Run it

From the repo root, **in the background**:

```bash
node e2e/barrage/barrage.mjs --target lower --tier <tier> > <scratchpad>/barrage.log 2>&1
```

It waits for any running lower deploy (and its e2e run) to finish before starting. **Don't run a
lower deploy, e2e run, or another barrage while it runs**; the 5-DTU database makes all of them
flaky. Follow progress by reading the log (one line per check); tell the user roughly how long
the tier takes and give short updates.

## 5. `--watch-deploy`

Start it **before** merging a PR to main (or right after). It syncs every ~2s and writes every ~15s
through the backend revision swap, stops by itself when the lower e2e run begins, then checks
convergence. Nothing else should load lower meanwhile.

## 6. Read and triage the report

When the run ends, read `e2e/barrage-reports/<run>/report.md`. Before calling anything a
regression:

- **Expected warnings** are listed in the README ("Reading a report"). Name them as known, don't
  re-investigate.
- **A failing browser scenario**: re-run just it (`--suites browser:<engine> --only <scenario>`,
  `--no-wait` if lower is otherwise quiet). Then look at the screenshot and the failure text: queued
  writes, differing workout ids, or a timeout. Read what the failure says before theorizing, and
  prove a hypothesis with a targeted probe before reporting it as fact.
- **Attribute it**:
  - Compare with the previous run's report, if one exists.
  - For app behavior, control-run the same scenario against the previous build (locally with
    `--target local` on the older commit, or via `--baseline` in `compare`).
  - A failure that reproduces on the previous build is pre-existing. Say so, with the numbers.
- **The drift canary failing (`ops`) is always serious**: a device found a month whose fingerprint
  matched while its content didn't. Report it first.

## 7. Report to the user

Lead with the answer: is it safe to proceed, and did anything fail. Then:

- a short table by suite (pass / fail / warn);
- each real failure: what the user would see, whether it reproduces, and whether it's new or
  pre-existing;
- the timing tables from the report;
- the report's path.

Keep known warnings to one line. Cleanup runs automatically. Confirm the account's workout count in
the report's cleanup row matches the seeded size.

If the barrage finds a real bug, don't fix it inside this command. Report it, and offer a fix
through the normal worktree -> PR -> `/deploy-to-lower` path.
