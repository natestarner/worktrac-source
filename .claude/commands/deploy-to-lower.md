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

## Runbook

### 1. Document requirements
Ensure the change is summarized where it belongs before shipping:
- Update the decision log `docs/exercise-favorites-redesign.md` if this change alters a
  recorded decision (append a new dated entry; don't rewrite history).
- Update `CLAUDE.md` notes if the data model, API contract, or a documented invariant changed.
- Draft the PR body now (what changed + why + how verified) — reuse it in step 9.

### 2. Add / update tests (including e2e)
- Backend JUnit, frontend Vitest, **and Playwright e2e** under `e2e/tests/`.
- Any new endpoint or user-facing feature needs coverage (CLAUDE.md testing rule). Add e2e
  for user-visible flows; update specs whose assertions the change breaks.

### 3. Run all tests locally
- `cd backend && mvn verify`
- `cd frontend && npm test`
- **e2e** (the only pre-merge e2e gate):
  1. Ensure local SQL Server is up: `docker start worktrac-sqlserver` (host port **1434**).
  2. Start backend `local` profile and frontend dev server — the frontend **must be on port
     3000** (local CORS only allows 3000; a stray 3000 server bumps Vite to 3001+ and causes
     silent 403s).
  3. `cd e2e && E2E_BASE_URL=http://localhost:3000 E2E_TEST_SUPPORT_KEY=<value from
     backend/src/main/resources/application-local.yml's app.email.test-support-key>
     npx playwright test`.
     - Registration in the local flow calls the real Azure Communication Services email
       API even though the e2e helper reads the confirmation code back via the
       test-support endpoint rather than an inbox — so `ACS_EMAIL_CONNECTION_STRING` and
       `ACS_EMAIL_SENDER_ADDRESS` must already be set in your shell environment (a
       free-tier ACS resource is fine), or every e2e test that registers a household
       fails at registration.
  4. Tear the local app back down: killing the launching shell command is **not
     enough** — `mvn spring-boot:run` forks a separate `java` process and `npm run dev`
     forks a separate `node`/vite process that both survive their parent being killed.
     Kill whatever is actually listening on 8080 and 3000 (e.g. find the PID via
     `netstat`/`lsof` and `taskkill`/`kill` it), not just the wrapper command. Leftover
     processes here don't just waste resources — they hold file locks on the worktree
     that will block its removal in step 13.

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
Watch that `worktrac-deploy` run to completion:
`gh run watch -R $OWNER/worktrac-deploy <run-id> --exit-status`. Confirm all four jobs green:
`deploy-backend-lower`, `deploy-frontend-lower`, `smoke-tests`, `e2e-tests`.
On failure: pull logs and the `playwright-report` artifact
(`gh run download -R $OWNER/worktrac-deploy <run-id> -n playwright-report`). If the failure is
code-caused, auto-fix via a new PR to source `main` (bounded), which re-triggers the whole
promote→deploy chain. If it's infra/secret/config, stop and report.

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
