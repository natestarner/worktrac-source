#!/usr/bin/env bash
# Safely retire finished worktrees under .claude/worktrees/, and the local branches they were on.
#
# This exists because BOTH halves of the obvious approach are wrong on this machine, and each one
# cost a round trip of back-and-forth before it was written down:
#
#   1. "Is this branch merged?" cannot be answered by ancestry. PRs here are SQUASH-merged, so the
#      branch's own commits are never ancestors of main. `git log main..branch` lists commits,
#      `git branch -d` refuses, and `git merge-base --is-ancestor` says no -- for a branch that was
#      fully merged days ago. On 2026-08-14 that reported a merged branch as "2 unmerged commits"
#      and it was nearly kept forever on that basis.
#
#      The authority is the PR: `gh pr view <n> --json headRefOid`. If the merged PR's head commit
#      equals the local branch tip, every commit on that branch reached main. Content-diffing
#      against main does NOT answer this -- main moves on, so a file the branch added and a later
#      PR removed looks identical to work that never merged.
#
#   2. `git worktree remove` fails on this repo's deep node_modules paths with "Filename too long"
#      -- AND STILL EXITS 0. It unregisters the worktree while leaving the directory on disk, so
#      the failure looks like success. It always needs an `rm -rf` + `git worktree prune` follow-up.
#
# Default is a DRY RUN: it prints the verdict for each worktree and changes nothing. Pass --force
# to actually remove the ones it judged safe.
#
#   bash scripts/worktree-cleanup.sh                  # report only
#   bash scripts/worktree-cleanup.sh --force          # remove every SAFE worktree + its branch
#   bash scripts/worktree-cleanup.sh --force <name>   # just that one, by directory name
#
# A worktree is SAFE only when all of these hold. Anything else is reported and skipped:
#   - it is not the primary checkout, and not the worktree you are currently in
#   - no tracked modifications and no untracked files (build/dep dirs excluded)
#   - its branch is merged, proven by a merged PR whose headRefOid == the branch tip,
#     or the branch is identical to origin/main
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FORCE=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --help|-h) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ONLY="$arg" ;;
  esac
done

# Untracked noise that never counts as work worth keeping.
IGNORE_UNTRACKED='node_modules|dist/|build/|\.dev-logs|test-results|playwright-report|pwa-report|\.env\.worktree'

command -v gh >/dev/null 2>&1 || { echo "gh CLI is required (it is the only reliable merged-check)." >&2; exit 1; }

git fetch origin main --quiet 2>/dev/null || echo "warning: could not fetch origin/main; verdicts may be stale" >&2

CURRENT="$(pwd -P)"
SAFE=(); UNSAFE=()

# `git worktree list --porcelain`, not the plain form: this repo's paths contain spaces
# ("Code Projects", "Workout Tracker"), so splitting the aligned columns on whitespace truncates
# every path and the loop silently matches nothing.
while IFS= read -r line; do
  case "$line" in "worktree "*) dir="${line#worktree }" ;; *) continue ;; esac
  case "$dir" in "$REPO_ROOT") continue ;; esac          # never the primary checkout
  case "$dir" in *".claude/worktrees/"*) ;; *) continue ;; esac
  name="$(basename "$dir")"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue

  branch="$(git -C "$dir" branch --show-current 2>/dev/null || echo '')"
  tip="$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo '')"
  echo "=== $name  [${branch:-detached}] ==="

  if [ "$(cd "$dir" && pwd -P)" = "$CURRENT" ]; then
    echo "  SKIP: this is the worktree you are currently in -- exit it first."
    UNSAFE+=("$name"); echo; continue
  fi

  # One source for both tracked modifications and untracked files -- `status --short` already
  # reports untracked as `??`, so pairing it with a second untracked query listed everything twice.
  changes="$(git -C "$dir" status --porcelain --untracked-files=all 2>/dev/null \
    | grep -Ev "$IGNORE_UNTRACKED" || true)"
  if [ -n "$changes" ]; then
    echo "  UNSAFE: uncommitted or untracked work present:"
    printf '%s\n' "$changes" | sed 's/^/    /' | head -10
    UNSAFE+=("$name"); echo; continue
  fi
  echo "  clean: no tracked changes, no untracked files"

  # The merged check. Ancestry is deliberately NOT used -- see the header.
  merged=0
  if [ -n "$branch" ]; then
    # `.[0] // empty` so "no PR for this branch" yields an empty string rather than the literal
    # "null null null", which otherwise printed as `PR #null is null, not merged`.
    read -r pr_num pr_state pr_head <<<"$(gh pr list --state all --head "$branch" \
      --json number,state,headRefOid \
      --jq '.[0] // empty | "\(.number) \(.state) \(.headRefOid)"' 2>/dev/null || echo '')"
    if [ "${pr_state:-}" = "MERGED" ] && [ "${pr_head:-}" = "$tip" ]; then
      echo "  merged: PR #$pr_num merged this exact commit (${tip:0:7})"
      merged=1
    elif [ "${pr_state:-}" = "MERGED" ]; then
      echo "  UNSAFE: PR #$pr_num merged ${pr_head:0:7}, but this branch is at ${tip:0:7}"
      echo "          -> commits were made after the merge; they exist only here."
    elif [ -n "${pr_num:-}" ]; then
      echo "  UNSAFE: PR #$pr_num is $pr_state, not merged"
    else
      # No PR at all. The only other proof is being identical to main.
      if [ -z "$(git diff origin/main "$branch" 2>/dev/null)" ]; then
        echo "  merged: no PR, but the tree is identical to origin/main"
        merged=1
      else
        echo "  UNSAFE: no PR found, and the tree differs from origin/main"
      fi
    fi
  fi

  if [ "$merged" -eq 1 ]; then
    if ! git ls-remote --heads origin "$branch" 2>/dev/null | grep -q .; then
      echo "  note: branch is local-only (no remote copy) -- removal is unrecoverable, but the"
      echo "        work is on main, so this is safe."
    fi
    SAFE+=("$name|$branch")
  else
    UNSAFE+=("$name")
  fi
  echo
done < <(git worktree list --porcelain)

if [ ${#SAFE[@]} -eq 0 ]; then
  echo "Nothing safe to remove."
  [ ${#UNSAFE[@]} -gt 0 ] && echo "Kept: ${UNSAFE[*]}"
  exit 0
fi

echo "SAFE to remove: $(printf '%s ' "${SAFE[@]%%|*}")"
[ ${#UNSAFE[@]} -gt 0 ] && echo "Keeping:        ${UNSAFE[*]}"

if [ "$FORCE" -ne 1 ]; then
  echo
  echo "Dry run -- nothing was changed. Re-run with --force to remove the safe ones."
  exit 0
fi

echo
for entry in "${SAFE[@]}"; do
  name="${entry%%|*}"; branch="${entry##*|}"
  dir="$REPO_ROOT/.claude/worktrees/$name"
  echo "Removing $name..."
  # Exits 0 even when it fails on a long path, so its result is deliberately not trusted.
  git worktree remove "$dir" >/dev/null 2>&1 || true
  rm -rf "$dir"
  if [ -e "$dir" ]; then
    echo "  ERROR: directory still present at $dir -- remove it by hand." >&2
    continue
  fi
  git worktree prune
  [ -n "$branch" ] && git branch -D "$branch" >/dev/null 2>&1 && echo "  deleted branch $branch"
  echo "  done"
done

echo
git worktree list
