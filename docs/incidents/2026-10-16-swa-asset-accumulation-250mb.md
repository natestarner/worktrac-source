# Lower's frontend deploy failed: 250 MB of accumulated build assets

**Date:** 2026-10-16
**Area:** CI / deploy
**Fix:** `promote-to-lower` prunes `frontend-build/assets/` to the outgoing build before laying
the new one down (`.github/workflows/ci.yml`, "Prune frontend assets older than the outgoing build").

## Symptom

The lower deploy for #397, a backend-only dependency bump, went red in `worktrac-deploy`'s
`deploy-lower.yml`. `deploy-backend-lower` succeeded; `deploy-frontend-lower` failed in
`Azure/static-web-apps-deploy` with:

> The content server has rejected the request with: BadRequest
> Reason: The size of the app content was too large. The limit for this Static Web App is
> 262144000 bytes.

`smoke-tests` and `e2e-tests` were skipped, so lower ended up on a new backend with the previous
frontend and nothing tested.

## Root cause

`promote-to-lower` checks out the deploy repo's `lower` branch and runs `actions/download-artifact`
into `deploy/frontend-build`. Download-artifact **overlays** files; it never deletes what is
already there. Vite content-hashes every asset, so each deploy added a fresh set of ~10 files
(a few MB) under `assets/` and left every previous set in place, then `git add -A` committed the
lot.

After ~50 deploys `frontend-build/` held 497 asset files and 252 MB, against the Free plan's
250 MB limit. The live build needs 10 of them. Nothing changed in the app; this deploy was just
the one that crossed the line.

The `production` branch is merged from `lower`, so it had accumulated the same way: **248 MB**
when this was found, two megabytes from failing its own next deploy.

## Fix

Before the download, delete every file in `assets/` that the **outgoing** build's `sw.js` does
not precache. Every file Vite emits into `assets/` is in the Workbox precache manifest (checked:
10 of 10), so this keeps exactly one previous generation. A tab still running the old build can
then lazy-load its chunks (the xlsx converter, Stripe) during a deploy, rather than hitting a 404
on a hashed file that was deleted underneath it.

It **fails safe**: if `sw.js` names no `assets/` entries, for example because the build's format
changed, it prints a warning and prunes nothing. The `grep` is wrapped in `|| true` for this;
under `set -o pipefail` a no-match `grep` would otherwise exit the step non-zero and fail the
deploy instead of skipping the prune.

Against a clone of `lower` the step took `assets/` from 252 MB to 2 MB and kept all 10 files of
the deployed build, including the bundle `index.html` loads. The first prune's deletions reach
`production` through the next ordinary lower → production merge.

## Takeaway

- `download-artifact` into a directory that is already populated is a **merge**, not a replace.
  Anything that publishes a build into a long-lived checkout must decide explicitly what it
  removes.
- Don't "simplify" the prune into `rm -rf frontend-build` before downloading. That deletes the
  previous generation too, and the mid-deploy reload is a condition the app must handle
  (`.claude/rules/resilience.md`, axis C).
