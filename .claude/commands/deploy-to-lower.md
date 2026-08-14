---
description: Ship the current worktree's branch to the lower environment — document, test (incl. e2e), open+merge PR, then monitor the automated lower deploy to green.
---

# /deploy-to-lower

Ship the change on the **current worktree's branch** all the way to the **lower**
environment. Run this only when the user explicitly invokes it (after their own local
testing). Once invoked, run **fully autonomously** through all steps below and **auto-fix**
failures — subject to the guardrails.

## Guardrails (always apply)

- **Bounded retries:** at any gate, attempt an auto-fix at most **3 times**; if still failing,
  **stop and report** with the error, the run/PR links, and what you tried. Never loop forever.
- **Never force-push. Never bypass branch protection.** Every path to `main` — including any
  automated fix after merge — goes through a PR with `backend-ci` + `frontend-ci` green.
- **Never run a destructive git command on a dirty tree.** `git reset --hard`, `git checkout -- .`
  and `git clean -fd` all destroy uncommitted work **permanently** — `git reflog` recovers
  commits, not edits that were never committed. Run `git status --short` first; if it is not
  empty, `git commit` or `git stash` before doing anything that moves the branch. This bit a real
  run on 2026-08-08: three finished fix edits were wiped by a `git reset --hard origin/main` used
  to re-point the worktree after a squash merge — see step 12's recipe for what to do instead.
- **Code failures → auto-fix. Infra/secret/config failures → stop and report** (e.g. Azure
  auth, missing GitHub secret, container-app not found, GHCR pull creds). You cannot fix those.
- Operate on the **current branch only**. Confirm you are in the intended worktree/branch and
  that `gh auth status` is authenticated before starting. Abort if the branch is `main`.
- Resolve repo owner dynamically: `OWNER=$(gh repo view --json owner -q .owner.login)`. The
  deploy repo is `$OWNER/worktrac-deploy` (same owner as this source repo).

## Pipeline facts (so the steps below are accurate)

- Pushing a branch runs **`ci.yml`** → jobs `backend-ci` (`mvn verify`) + `frontend-ci`
  (Vitest + build). **Playwright e2e does NOT run in branch/PR CI** — step 3's local e2e run
  is the only pre-merge e2e gate.
- `main` is **branch-protected**: merge requires a PR with required checks `backend-ci` +
  `frontend-ci` green. You cannot push to `main` directly.
- On merge to `main`, the source repo automatically runs `docker-build` (GHCR image + Trivy)
  then `promote-to-lower`, which **pushes the image tag + frontend build to the
  `worktrac-deploy` repo's `lower` branch**.
- That push triggers `worktrac-deploy`'s **`deploy-lower.yml`** → jobs
  `deploy-backend-lower`, `deploy-frontend-lower`, `smoke-tests`, `e2e-tests`. This is where
  the lower deploy + lower smoke/e2e actually happen (expect **10–20 min**, incl. Azure
  free-tier cold starts).
- Lower URLs: frontend `https://app.dev.huddle.fitness`
  (`https://black-flower-0c9bf9d0f.7.azurestaticapps.net`), backend health
  `https://worktrac-backend-lower.whitehill-3dc27bb3.eastus.azurecontainerapps.io/actuator/health`.
- **Lower is a single, shared, mutable environment — deploys serialize but don't gate on
  green.** `deploy-lower.yml` has a `concurrency` group, so if another worktree's deploy is
  already running, this one **queues** rather than overlapping (no two `e2e-tests` runs ever
  hit the same lower DB at once). But the slot releases the instant a run finishes, **pass or
  fail** — a red run is never held open waiting for a fix, and merges to `main` are never
  blocked by it. Since `main` is linear, lower always converges to the latest merged commit
  regardless. This means: **treat a lower e2e failure as possibly not yours** — see step 12's
  attribution protocol before fixing anything.

## Runbook

### 1. Document requirements
Ensure the change is summarized where it belongs before shipping:
- Update the decision log `docs/exercise-favorites-redesign.md` if this change alters a
  recorded decision (append a new dated entry; don't rewrite history).
- **Document to the narrowest place that fits** — see "Where new documentation goes" in
  `CLAUDE.md`:
  - A new/changed **invariant** a future change must not break → the matching
    `.claude/rules/*.md` (it auto-loads when Claude touches those files).
  - **Narrative / rationale / design discussion** → `docs/architecture/`.
  - A **post-mortem** for a bug that was hard to find → a new
    `docs/incidents/YYYY-MM-DD-slug.md` plus a row in `docs/incidents/README.md`.
  - Only touch `CLAUDE.md` itself if the change affects a rule that applies to **every** task.
    **Never paste subsystem detail back into it** — it loads on every request, and it reached
    84 KB exactly this way.
- Draft the PR body now (what changed + why + how verified) — reuse it in step 9.

### 2. Add / update tests (including e2e)
- Backend JUnit, frontend Vitest, **and Playwright e2e** under `e2e/tests/`.
- Any new endpoint or user-facing feature needs coverage (CLAUDE.md testing rule). Add e2e
  for user-visible flows; update specs whose assertions the change breaks.

### 3. Run all tests locally

`cd backend && mvn verify` and `cd frontend && npm test` first — both are cheap and catch most
things before you spend minutes on a stack.

#### e2e — the only pre-merge e2e gate. Follow this exactly.

**Never run `npx playwright test` directly. Always go through `scripts/e2e.sh`.** This is not a
style preference — it is the difference between a five-minute gate and an hour of chasing
phantom regressions, which has happened. Raw playwright:
- defaults to `http://localhost:3000`, which for **any worktree other than the primary `main`
  checkout** is either nothing or *a sibling session's stack* — you silently test the wrong app;
- has no idea the dev server died mid-run, so you get ~60 red specs across unrelated files
  (`smoke.spec.ts` among them) that read exactly like a code regression.

`scripts/e2e.sh` resolves this worktree's own ports, starts-or-reuses a readiness-gated stack,
and **after the run tells you if the stack didn't outlive it**.

**Use two separate tool calls.** The Vite dev server has a known, still-unresolved habit of dying
partway through a long suite, and the one surviving correlation is `up.sh` sharing a shell
invocation with the run (see the `KNOWN UNRESOLVED` block in `scripts/up.sh`):

```bash
bash scripts/up.sh      # call 1: starts this worktree's stack, waits until both answer
bash scripts/e2e.sh     # call 2: reuses that healthy stack and runs the suite
```

Pass extra args after `--`, e.g. `bash scripts/e2e.sh -- --grep "@smoke"`. Use
`bash scripts/e2e.sh --restart` after **backend** changes — `mvn spring-boot:run` has no
hot-reload, so a reused backend still serves the code it booted with. Vite does hot-reload, so
frontend edits are picked up by a reused stack.

Prerequisites:
- Local SQL Server up: `docker start worktrac-sqlserver` (host port **1434**, not 1433).
- `E2E_TEST_SUPPORT_KEY` exported (value is `app.email.test-support-key` in
  `backend/src/main/resources/application-local.yml`). `e2e.sh` fails fast if it's missing.
- `ACS_EMAIL_CONNECTION_STRING` / `ACS_EMAIL_SENDER_ADDRESS` set — local registration calls the
  real ACS email API even though the helper reads the code back via the test-support endpoint,
  so without them **every** spec that registers a household fails at registration.

#### Then the service-worker suite — `offline-durability.spec.ts`

This one needs the **backend up but the frontend port free**, which no single script does — so
stop only the frontend, by PID:

```bash
bash scripts/up.sh                                       # both up; note the ports it prints
netstat -ano | grep ":<FRONTEND_PORT>" | grep LISTENING  # find the vite dev PID
powershell.exe -NoProfile -Command "Stop-Process -Id <pid> -Force"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<BACKEND_PORT>/actuator/health   # expect 200

cd e2e && FRONTEND_PORT=<FRONTEND_PORT> VITE_BACKEND_ORIGIN=http://localhost:<BACKEND_PORT> \
  npm run test:pwa
```

**Do not use `down.sh` here** — it stops the backend too, and these specs need it. And the preview
must take *that same* frontend port, not a free one: `worktree-env.sh` sets
`CORS_ALLOWED_ORIGINS` to exactly one origin, and `vite preview`'s proxy forwards the browser's
real `Origin`, so any other port is refused. `playwright.pwa.config.ts` starts its own
`vite preview` with `reuseExistingServer: false`, which is why the dev server has to be out of the
way first.

**All 4 should pass.** Treat any failure here as yours. (One of them was recorded as a known
pre-existing failure from 2026-08-10 to 2026-08-14. It wasn't rot and it wasn't the app — the
harness was measuring lie-fi, because `context.setOffline` does not survive into the document a
reload creates. See `docs/incidents/2026-08-14-cold-boot-offline-spec-measured-liefi.md`.)

Four specs that **cannot** run in the default project: they need the production service worker to
precache the app shell, which `vite dev` does not provide, so `playwright.config.ts` excludes them
and `playwright.pwa.config.ts` builds + previews instead. They are the regression tests for two of
the most expensive incidents in `docs/incidents/` — an ended workout coming back to life, and a
create-then-log-set deadlocking the outbox across a reload mid-lie-fi.

Until 2026-08-09 nothing ran them: not the default local gate, not branch CI (which has no
Playwright at all), and not this runbook. **Run them whenever the change touches
`frontend/src/lib/**`, `frontend/src/hooks/**`, the service worker, or anything persisted.**
They take a couple of minutes because of the production build.

**Reading the result — do this before believing any failure:**
1. If `e2e.sh` printed the "⚠️ The frontend/backend died during this run" banner, the failures
   above it are **not** yours. Re-run from a fresh `bash scripts/up.sh` in a separate call.
2. Many unrelated specs failing at once — especially if `smoke.spec.ts` is among them — is that
   same symptom even without the banner. Check `curl localhost:<FRONTEND_PORT>` before debugging.
3. A **single** spec failing, or a small set that **changes between runs**, is this repo's known
   local worker-contention flake (`offline-reads`, `multi-person`, `intermittent-errors` are the
   usual names). Confirm by re-running that spec alone before treating it as a regression.

**Leave the stack running** — step 12 may need it, and `/stop-local` is the teardown. If you do
tear down, use `bash scripts/down.sh`: killing the launching shell command is not enough, since
`mvn spring-boot:run` and `npm run dev` both fork processes that outlive their parent, and
leftovers hold file locks that block worktree removal in step 13.

### 4. Resolve issues
Fix any failures from step 3; re-run until green (bounded retries). If a failure is
environmental (e.g. Docker/SQL not available locally) and not a code defect, report it.

### 5. Commit to the branch (never main)
Commit on the current worktree branch with a Conventional Commit message
(`feat(scope):` / `fix(scope):` / `refactor:` / `docs:` / `test:`). Never commit to `main`.

### 6. Push the branch to remote
Before pushing, confirm the branch name is clean (`git branch --show-current`) —
`EnterWorktree`'s auto-generated names (e.g. `worktree-fix+scope-description` when a
`/`-containing name was requested) aren't suitable as the PR's branch; rename first if
needed: `git branch -m <old> <new>`.

`git push -u origin <branch>` — this triggers `ci.yml` (`backend-ci` + `frontend-ci`).

### 7. Ensure branch CI passes
Watch that run to completion, e.g. `gh run watch <run-id> --exit-status` (find it with
`gh run list --branch <branch> --limit 1`). Confirm both jobs are green.

### 8. Resolve CI issues
On failure: read logs (`gh run view <run-id> --log-failed`), fix, commit, re-push, re-watch
(bounded retries).

### 9. Merge to main (via PR — required)
- `gh pr create --base main --head <branch> --title "<conventional title>" --body "<from step 1>"`
  (skip create if a PR already exists).
- Wait for required checks: `gh pr checks <pr> --watch` until `backend-ci` + `frontend-ci` pass.
- Merge: `gh pr merge <pr> --squash` (squash keeps conventional-commit history clean).
  **Do NOT pass `--delete-branch`**: that flag makes `gh` try to check out the base
  branch (`main`) locally afterward, which fails with
  `fatal: 'main' is already used by worktree at ...` every time, since this project's
  workflow always keeps `main` checked out in the primary working directory while you
  work from a worktree. If you see that error, don't retry the merge command — check
  `gh pr view <pr> --json state,mergedAt` first; the merge itself likely already
  succeeded via the API before the local git operation failed, and retrying just
  reports "already merged."
- Delete the remote branch explicitly instead: `git push origin --delete <branch>`.

### 10. Ensure post-merge CI/CD completes
Watch the `main`-push run (`gh run list --branch main --limit 1`): `backend-ci`,
`frontend-ci`, `docker-build` (image + Trivy scan), `promote-to-lower` — all green. If it
fails on a code issue, auto-fix via a **new branch → PR → merge** (bounded); you cannot push
`main` directly. If Trivy fails on a real HIGH/CRITICAL, patch/upgrade the flagged dependency
(don't narrow scan scope).

### 11. Ensure the deploy repo was invoked
Confirm `promote-to-lower` pushed to `worktrac-deploy`'s `lower` branch and that the deploy
workflow started:
`gh run list -R $OWNER/worktrac-deploy --workflow=deploy-lower.yml --limit 1`.

### 12. Ensure lower deploy + smoke/e2e pass

**Fast path — one call to watch, one call to triage.** `gh run watch` streams a lot of output for
little signal; prefer polling the job rollup, which is what you actually need:

```bash
# Watch to completion, then print just the four job verdicts.
gh run watch -R $OWNER/worktrac-deploy <run-id> > /dev/null 2>&1
gh run view -R $OWNER/worktrac-deploy <run-id> \
  --json status,conclusion,jobs \
  -q '{status, conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

All four must be green: `deploy-backend-lower`, `deploy-frontend-lower`, `smoke-tests`,
`e2e-tests`.

If `e2e-tests` is red, get the failing spec names in **one** call before doing anything else —
that list is what the attribution protocol below operates on:

```bash
gh run view -R $OWNER/worktrac-deploy <run-id> --log-failed 2>/dev/null \
  | grep -oE '›[^›]+\.spec\.ts:[0-9]+:[0-9]+ › .*' | sort -u
```

Lower e2e runs against the **deployed** app, not a dev server, so the local dev-server death in
step 3 has no analogue here — a red `e2e-tests` is either a real regression or someone else's
(see attribution below). Do not port local-flake reasoning to it.

**On an `e2e-tests` failure, don't assume it's yours — another worktree's deploy may have
queued behind this one (or just ahead of it) and surfaced the same red first.** Because lower
is shared and deploys only serialize (see the pipeline fact above), a failure here can belong
to whichever merge *first* introduced it. Work through these three steps, in order, before
writing any fix:

1. **Attribute by diff against the previous run.** Pull this run's failing specs (`gh run
   download -R $OWNER/worktrac-deploy <run-id> -n playwright-report`, or `gh run view -R
   $OWNER/worktrac-deploy <run-id> --log-failed`) and the **immediately preceding**
   `deploy-lower.yml` run's failing specs (`gh run list -R $OWNER/worktrac-deploy
   --workflow=deploy-lower.yml --limit 2` to find its run-id, then the same commands against
   it). **A spec failing in both runs is pre-existing — it belongs to whatever merge is
   already ahead of yours on `main`; skip it, don't fix it here.** Only a spec that's newly
   failing (absent from the previous run's failures) is this deploy's to fix. If every failing
   spec here already failed in the previous run, there is nothing for this `/deploy-to-lower`
   invocation to fix — report that upstream and stop (don't re-fix someone else's in-flight
   failure).
2. **Claim ledger, for the case two deploys land too close together to diff cleanly** (the
   "previous run" was still green when both started). Run these `gh issue`/`gh label` commands
   with **no `-R`** — unlike the `worktrac-deploy` run/log commands above, these target the
   current source repo (this skill always runs from inside a source-repo worktree, which `gh`
   resolves automatically). Before starting a fix on a genuinely net-new failing spec: `gh
   issue list --label lower-red --search "<spec-file-name> in:title" --state open`. If an open
   issue already claims that spec, **skip it** — another session is already on it; don't
   duplicate the work. Otherwise claim it yourself: `gh label create lower-red --color d73a4a
   --force` (idempotent, creates the label the first time this is ever used, harmlessly no-ops
   after), then `gh issue create --title "lower-red: <spec-file-name>" --label lower-red --body
   "Claimed by an in-progress /deploy-to-lower run fixing this lower e2e failure."`. Reference
   that issue number in the fix PR's body (`Closes #<n>`) so it closes automatically on merge,
   releasing the claim.
3. **Fix only what step 1 attributed to you**, via a new PR to source `main` (bounded retries,
   same as step 10), which re-triggers the whole promote→deploy chain. A failure attributed to
   an earlier merge is not yours to fix here — if it's still red after that earlier merge's own
   fix should have landed, report it rather than fixing it yourself under this invocation.

   **Starting that fix branch — the exact sequence, because the obvious move is wrong.** Your
   worktree is still on the branch that was just *squash*-merged, so its commits are not
   ancestors of `main` even though their content is. `git log origin/main..HEAD` therefore looks
   like unmerged work, and `git status` may be dirty if you started editing before re-branching.
   Do this:

   ```bash
   git status --short                        # MUST be empty -- commit or `git stash` first
   git fetch origin main
   git checkout -b <fix-branch> origin/main  # safe: no-op on the tree when content already matches
   ```

   **Do not use `git reset --hard origin/main` for this.** It is the move that suggests itself
   (the branch "looks behind"), it is not needed — `checkout -b` from a clean tree does the whole
   job — and it silently and permanently destroys uncommitted edits. Sequence matters: re-branch
   **first**, then write the fix. If you already wrote the fix, commit or stash it before
   re-branching, then `git cherry-pick`/`git stash pop` onto the new branch.

   Verifying a squash-merged branch really is merged (before deleting it or removing the
   worktree): `git diff origin/main --stat` being empty is the check that works — `git log
   origin/main..HEAD` and `git branch -d` both report false positives after a squash merge.

If the failure is infra/secret/config rather than code, stop and report regardless of
attribution — you can't fix those either way.

### 13. Report & clean up
- Report a summary of what shipped, with links: the source `main` Actions run, the
  `worktrac-deploy` `deploy-lower.yml` run, the `playwright-report` artifact, and the lower
  URLs above.
- Cleanup: the remote branch was already deleted explicitly in step 9; remove the local
  worktree (`ExitWorktree` with `action: remove`, or `git worktree remove`) now that it's
  merged, and leave the primary working directory on a clean, up-to-date `main`
  (`git -C <primary> pull --ff-only`).
- If worktree removal fails with a "busy"/"in use"/"resource busy" error, a local process
  from step 3.4 is still holding a file handle open in the worktree — find the orphaned
  `java`/`node` process rooted at the worktree's path (e.g. inspect running processes'
  command lines) and kill it before retrying the removal.
- **`ExitWorktree`/`git worktree remove` routinely half-succeeds on Windows**: it unregisters the
  worktree (so `git worktree list` looks clean and a retry says *"is not a working tree"*) while
  leaving the directory — and its ~180 MB of `node_modules` — on disk. Always confirm with
  `ls .claude/worktrees/`, and `rm -rf` the leftover directory if it's still there.
- `ExitWorktree` may also refuse with *"has N commits"* and name the branch by its **original**
  name if you renamed it in step 6. That count is the squash-merge false positive above — verify
  with `git diff origin/main --stat` (empty = merged), then pass `discard_changes: true`.
- Local branches from this run won't delete with `git branch -d` after a squash merge for the same
  reason; use `git branch -D` once the diff check confirms they're merged. Leave any branch you
  did not create alone — a sibling session may be mid-task on it.
