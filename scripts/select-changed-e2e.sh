#!/usr/bin/env bash
# Picks the e2e tests a lower deploy should run IN ADDITION to @critical: every test in a spec file
# that changed since the last lower deploy that went green -- or that imports a file that changed
# (a shared helper under e2e/tests/support/, say). Used by worktrac-deploy's deploy-lower.yml
# `e2e-changed` job; see e2e-tests.md, "Tiers".
#
# Selection is by spec FILE (e2e/scripts/changed-specs.mjs, which follows imports), passed to
# `playwright test <files>`. Not Playwright's own `--only-changed`: that attributes each test to the
# file where test() is CALLED, which for every parity spec is support/parity.ts, so it skipped a
# changed parity spec's parity tests (2 of the file's 6 on its first real run, 2026-10-31).
#
# The comparison point is the source commit of the last SUCCESSFUL lower deploy, not merely the
# previous one: a deploy that went red, or one superseded while queued, never proved its new
# tests, so they stay selected until a deploy passes with them.
#
# Burn-in: a new test that passes once can still be flaky, and on lower that surfaces later as
# nightly noise. So a small selection runs each test 3 times; a large one (a shared-helper change)
# runs once, so one broad change can't triple a deploy.
#
# Run from a FULL clone of worktrac-source (fetch-depth: 0 -- the ref must be in history), with
# GH_TOKEN able to read worktrac-deploy's Actions runs. Writes to $GITHUB_OUTPUT: count, and when
# count > 0, files (space-separated, relative to e2e/; EMPTY means the whole suite) and repeats.
# Prints why when it selects nothing.
#
# Locally, read-only, to see what a deploy would select:
#   bash scripts/select-changed-e2e.sh natestarner/worktrac-deploy 0
set -euo pipefail

deploy_repo="${1:?deploy repo, e.g. natestarner/worktrac-deploy}"
current_run="${2:?the current run id, or 0 locally}"
output="${GITHUB_OUTPUT:-/dev/stdout}"
BURN_IN_REPEATS=3
BURN_IN_MAX_TESTS=20

emit() { echo "$1=$2" >> "$output"; }
nothing() {
  echo "::notice title=New or changed e2e::$1 -- running @critical only."
  emit count 0
  exit 0
}

last_green=$(gh api "repos/$deploy_repo/actions/workflows/deploy-lower.yml/runs?branch=lower&status=success&per_page=20" \
  --jq "[.workflow_runs[] | select(.id != $current_run)][0].head_sha // empty")
[ -n "$last_green" ] || nothing "no earlier green lower deploy to compare against"

# The deploy commit's message names the source commit it shipped. A commit with no such line (a
# merged deploy-repo PR) shipped no new source, so walk back to the nearest one that did.
base=$(gh api "repos/$deploy_repo/commits?sha=$last_green&per_page=30" \
  --jq '[.[].commit.message | capture("Source commit: (?<s>[0-9a-f]{40})").s][0] // empty')
[ -n "$base" ] || nothing "can't tell which source commit the last green deploy ($last_green) shipped"
git cat-file -e "$base^{commit}" 2>/dev/null \
  || nothing "source commit $base isn't in this checkout's history (shallow clone?)"

cd "$(git rev-parse --show-toplevel)/e2e"
specs=$(node scripts/changed-specs.mjs "$base")
[ -n "$specs" ] || nothing "no spec, and no file a spec imports, changed since ${base::7}"
if [ "$specs" = "ALL" ]; then
  files=""
  what="the whole suite (the Playwright config or the e2e packages changed)"
else
  files=$(echo $specs)
  what="$(wc -w <<<"$files" | tr -d ' ') spec file(s) changed since ${base::7}: $files"
fi

# $files is deliberately unquoted: it is a word list (and empty means the whole suite).
listing=$(npx playwright test --list $files 2>&1 || true)
count=$(sed -nE 's/^Total: ([0-9]+) tests? in .*/\1/p' <<<"$listing" | tail -1)
count=${count:-0}
[ "$count" -gt 0 ] || nothing "$what, but they hold no tests"

repeats=1
[ "$count" -le "$BURN_IN_MAX_TESTS" ] && repeats=$BURN_IN_REPEATS
echo "::notice title=New or changed e2e::$count test(s) in $what -- running each ${repeats}x."
emit count "$count"
emit files "$files"
emit repeats "$repeats"
# Still emitted for a deploy-lower.yml that predates `files` and passes --only-changed=<base>, so a
# deploy between this change and worktrac-deploy's switch to `files` keeps working.
emit base "$base"
