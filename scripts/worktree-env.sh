#!/usr/bin/env bash
# Sourced (not executed) by every other scripts/*.sh. Derives a stable per-worktree identity
# -- ports and a database name -- so N worktrees can run their own full local stack at the
# same time with zero collision. The primary `main` checkout keeps the historical defaults
# (backend :8080, frontend :3000, database `worktrac`) so existing muscle memory and any
# external bookmarks/scripts pointing at those ports keep working unchanged.
#
# Usage: `source "$(dirname "${BASH_SOURCE[0]}")/worktree-env.sh"` from another script in
# this directory. Exports: WORKTREE_SLUG, BACKEND_PORT, FRONTEND_PORT, DB_NAME,
# SPRING_DATASOURCE_URL, CORS_ALLOWED_ORIGINS, VITE_BACKEND_ORIGIN, APP_EMAIL_APP_URL.
set -euo pipefail

_WTENV_REPO_ROOT="$(git rev-parse --show-toplevel)"

# "Which repo am I?" must have ONE answer. This file asks the working directory (git rev-parse
# above); every sourcing script independently asks its own location ($SCRIPT_DIR/..), and then acts
# on that -- e2e.sh does `cd "$REPO_ROOT/e2e"`, up.sh launches from its own tree, down.sh reads its
# own .dev-logs. Invoke another checkout's copy by absolute path and the two answers diverge: you
# get THIS worktree's ports, database and CORS origin running THAT tree's specs and node_modules.
#
# It is silent, and it presents as ~100 unrelated red specs with smoke.spec.ts among them -- which
# .claude/rules/e2e-tests.md correctly teaches you to read as "the stack, not the code", so the real
# cause is actively disguised. It cost a full-suite run on 2026-08-12; the only tell was that the
# other checkout happened to have no Playwright browser installed. Had both been installed it would
# have returned a plausible green/red result for code that was never under test.
#
# Guarded here rather than in each script because this is the one file all seven already share.
# BASH_SOURCE[1] is the sourcing script; unset when a human sources this directly, which is fine.
#
# LIMITATION: this protects the tree that CONTAINS it, since the wrong copy sources its own
# worktree-env.sh. So it starts protecting the primary checkout only once this reaches main, and a
# worktree branched from before that stays unguarded. It is a backstop, not a substitute for
# invoking `bash scripts/<name>.sh` by RELATIVE path from the worktree you mean -- which is what
# .claude/commands/deploy-to-lower.md already tells you to do.
#
# Both sides go through `cd ... && pwd` before comparing. On Git Bash these are the SAME directory
# in two spellings -- `git rev-parse --show-toplevel` returns `C:/Users/...` while `cd && pwd`
# returns `/c/Users/...` -- so comparing them raw makes the guard fire on every invocation of every
# script. Only the comparison is normalized; _WTENV_REPO_ROOT keeps its native spelling, which the
# docker/java/node call sites downstream depend on.
if [ -n "${BASH_SOURCE[1]:-}" ]; then
  _WTENV_CALLER_ROOT="$(cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)"
  _WTENV_CWD_ROOT="$(cd "$_WTENV_REPO_ROOT" && pwd)"
  if [ "$_WTENV_CALLER_ROOT" != "$_WTENV_CWD_ROOT" ]; then
    echo "ERROR: $(basename "${BASH_SOURCE[1]}") belongs to a different checkout than your shell." >&2
    echo "  script : $_WTENV_CALLER_ROOT" >&2
    echo "  cwd    : $_WTENV_CWD_ROOT" >&2
    echo "" >&2
    echo "  Running it would mix this worktree's ports/database with that tree's code." >&2
    echo "  Run this worktree's own copy instead:" >&2
    echo "    bash $_WTENV_REPO_ROOT/scripts/$(basename "${BASH_SOURCE[1]}")" >&2
    exit 1
  fi
fi
_WTENV_BRANCH="$(git -C "$_WTENV_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$_WTENV_BRANCH" ] || [ "$_WTENV_BRANCH" = "HEAD" ]; then
  # Detached HEAD (rare) -- fall back to the directory name so this is still stable/repeatable.
  _WTENV_BRANCH="$(basename "$_WTENV_REPO_ROOT")"
fi

_wtenv_slugify() {
  echo -n "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g' | cut -c1-30
}

_WTENV_FILE="$_WTENV_REPO_ROOT/.env.worktree"

if [ "$_WTENV_BRANCH" = "main" ]; then
  WORKTREE_SLUG="main"
  BACKEND_PORT=8080
  FRONTEND_PORT=3000
  DB_NAME="worktrac"
else
  WORKTREE_SLUG="$(_wtenv_slugify "$_WTENV_BRANCH")"
  BACKEND_PORT=""
  FRONTEND_PORT=""
  if [ -f "$_WTENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$_WTENV_FILE"
  fi
  # Ports every OTHER worktree has already written into its own .env.worktree. A port with
  # nothing LISTENING on it is NOT free if a sibling has it cached -- that sibling's stack is
  # merely stopped right now, and both up.sh and down.sh act by port, so sharing one means each
  # worktree silently tears the other's stack down. That is exactly what happened: three
  # worktrees all allocated 8081/3001 because each probed while the others were stopped, and
  # from then on every up.sh/down.sh killed a concurrent session's dev servers mid-run --
  # which looked for all the world like the Vite dev server crashing on its own.
  _wtenv_sibling_claims() {
    local self me f
    self="$(basename "$_WTENV_REPO_ROOT")"
    for f in "$_WTENV_REPO_ROOT"/../*/.env.worktree; do
      [ -f "$f" ] || continue
      me="$(basename "$(dirname "$f")")"
      [ "$me" = "$self" ] && continue
      sed -nE 's/^(BACKEND|FRONTEND)_PORT=([0-9]+)$/\2/p' "$f"
    done
  }
  _WTENV_CLAIMED="$(_wtenv_sibling_claims || true)"

  _wtenv_port_taken() {
    # The primary `main` checkout's fixed ports are never up for grabs, even while it's stopped.
    if [ "$1" = "8080" ] || [ "$1" = "3000" ]; then return 0; fi
    if netstat -ano 2>/dev/null | grep -qE ":$1[[:space:]].*LISTENING"; then return 0; fi
    if printf '%s\n' "$_WTENV_CLAIMED" | grep -qx "$1"; then return 0; fi
    return 1
  }

  # A pre-existing collision is only WARNED about, never auto-resolved. Reallocating here would
  # have to pick a loser, and any rule for that can move a worktree whose stack is running right
  # now out from under it. Deleting the offending .env.worktree (the file says it's safe to) and
  # re-running is the deliberate, human-timed fix.
  if [ -n "${BACKEND_PORT:-}" ] && [ -n "${FRONTEND_PORT:-}" ] \
     && printf '%s\n' "$_WTENV_CLAIMED" | grep -qxE "$BACKEND_PORT|$FRONTEND_PORT"; then
    echo "worktree-env: WARNING -- :$BACKEND_PORT/:$FRONTEND_PORT are also claimed by another" \
         "worktree. up.sh/down.sh act by port, so these two worktrees will kill each other's" \
         "stacks. Delete this worktree's .env.worktree and re-run to move onto free ports." >&2
  fi

  if [ -z "${BACKEND_PORT:-}" ] || [ -z "${FRONTEND_PORT:-}" ]; then
    BACKEND_PORT=8081
    while _wtenv_port_taken "$BACKEND_PORT"; do BACKEND_PORT=$((BACKEND_PORT + 1)); done
    FRONTEND_PORT=3001
    while _wtenv_port_taken "$FRONTEND_PORT"; do FRONTEND_PORT=$((FRONTEND_PORT + 1)); done
    {
      echo "# Auto-generated by scripts/worktree-env.sh for worktree branch '$_WTENV_BRANCH'."
      echo "# Safe to delete -- ports will be reallocated (possibly differently) on the next run."
      echo "WORKTREE_SLUG=$WORKTREE_SLUG"
      echo "BACKEND_PORT=$BACKEND_PORT"
      echo "FRONTEND_PORT=$FRONTEND_PORT"
    } > "$_WTENV_FILE"
  fi
  DB_NAME="worktrac_${WORKTREE_SLUG}"
fi

export WORKTREE_SLUG BACKEND_PORT FRONTEND_PORT DB_NAME
export SPRING_DATASOURCE_URL="jdbc:sqlserver://localhost:1434;database=${DB_NAME};encrypt=false;trustServerCertificate=true"
export CORS_ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT}"
export VITE_BACKEND_ORIGIN="http://localhost:${BACKEND_PORT}"
export APP_EMAIL_APP_URL="http://localhost:${FRONTEND_PORT}/app/log"
