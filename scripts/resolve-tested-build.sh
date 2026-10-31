#!/usr/bin/env bash
# Decides whether a push to main can promote the build its PR's CI already produced and tested,
# instead of building and testing the identical code a second time (ci.yml's resolve-tested-build).
#
# The fast path is taken only when ALL of these hold; anything else prints why and falls back to
# the full build, so a wrong answer here can only ever cost time, never ship something untested:
#   1. this commit belongs to a merged PR
#   2. the PR's head commit has the SAME git tree as this commit -- byte-for-byte the same files.
#      "Protect main" requires branches to be up to date before merging, so this is the normal case
#   3. that head's pull_request CI run passed every job that gates a merge plus docker-build
#   4. the run still holds the three deployable artifacts, and the image is named for THIS tree
#      (docker-build names it backend-image-<tree of the code it built>), which is the proof that
#      the image is this exact code and not just this PR's
#
# Writes to $GITHUB_OUTPUT: fast=true|false, and on the fast path pr, run_id and the three
# artifact ids. Needs GH_TOKEN (actions:read, contents:read, pull-requests:read).
#
# Runs locally too, read-only, to see what a given main commit would do:
#   GITHUB_REPOSITORY=natestarner/worktrac-source GITHUB_SHA=<sha> bash scripts/resolve-tested-build.sh
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
sha="${GITHUB_SHA:?GITHUB_SHA is required}"
output="${GITHUB_OUTPUT:-/dev/stdout}"

emit() { echo "$1=$2" >> "$output"; }
fallback() {
  echo "::notice title=Full build::$1"
  emit fast false
  exit 0
}

tree=$(gh api "repos/$repo/git/commits/$sha" --jq '.tree.sha' 2>/dev/null) \
  || fallback "could not read the tree of $sha"

pr=$(gh api "repos/$repo/commits/$sha/pulls" \
  --jq '[.[] | select(.merged_at != null)][0].number // empty' 2>/dev/null) || pr=""
[ -n "$pr" ] || fallback "$sha is not the merge of a PR"

head=$(gh api "repos/$repo/pulls/$pr" --jq '.head.sha')
head_tree=$(gh api "repos/$repo/git/commits/$head" --jq '.tree.sha')
[ "$head_tree" = "$tree" ] \
  || fallback "PR #$pr's head ($head) has different files from main -- it was not up to date when merged"

run=$(gh api "repos/$repo/actions/workflows/ci.yml/runs?event=pull_request&head_sha=$head&per_page=30" \
  --jq '[.workflow_runs[] | select(.status == "completed")] | sort_by(.run_number) | last | .id // empty')
[ -n "$run" ] || fallback "PR #$pr's head $head has no completed pull_request CI run"

for job in changes resilience-guard backend-ci frontend-ci marketing-ci docker-build; do
  conclusion=$(gh api "repos/$repo/actions/runs/$run/jobs?per_page=100" \
    --jq "[.jobs[] | select(.name == \"$job\")][0].conclusion // \"missing\"")
  [ "$conclusion" = "success" ] || fallback "PR #$pr's CI run $run: $job was $conclusion"
done

artifact_id() {
  gh api "repos/$repo/actions/runs/$run/artifacts?per_page=100" \
    --jq "[.artifacts[] | select(.name == \"$1\" and .expired == false)] | sort_by(.created_at) | last | .id // empty"
}
image=$(artifact_id "backend-image-$tree")
frontend=$(artifact_id frontend-build)
marketing=$(artifact_id marketing-build)
[ -n "$image" ] && [ -n "$frontend" ] && [ -n "$marketing" ] \
  || fallback "PR #$pr's CI run $run is missing a build (image for tree $tree: ${image:-none}, frontend: ${frontend:-none}, marketing: ${marketing:-none})"

echo "::notice title=Promoting the tested build::PR #$pr, CI run $run, tree $tree -- nothing is rebuilt"
emit fast true
emit pr "$pr"
emit run_id "$run"
emit image_artifact "$image"
emit frontend_artifact "$frontend"
emit marketing_artifact "$marketing"
