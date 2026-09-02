#!/usr/bin/env bash
# Refuse to be surprised by a known-bad Node.js build.
#
# 2026-09-01: the Vite dev server had been dying mid-e2e-run for weeks with no error output. It
# was not Vite. Node v24.15.0 corrupts its own stack under concurrent load on Windows; the /GS
# stack-cookie check catches it and fail-fasts the process instantly and SILENTLY (native exit
# 0xC0000409, fast-fail subcode 2 = STACK_COOKIE_CHECK_FAILURE, confirmed from a minidump).
#
# Measured on this repo's own e2e suite at E2E_WORKERS=11:
#     v24.15.0  -> 2 crashes in 3 runs (plus 3 earlier hunts that crashed on the first run)
#     v24.14.1  -> 0 crashes in 8 runs
# Reproduces identically on Vite 7 and Vite 8, so it is Node, not the toolchain.
# Upstream: https://github.com/nodejs/node/issues/62991
#
# Full narrative: docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md
#
# Deliberately a WARNING, not a hard failure: a developer who has only the bad build installed
# still needs to be able to run the stack, and the death ledger now types these crashes correctly
# (scripts/supervise-server.js records the native exit code). The point is that nobody should ever
# again spend a week chasing a phantom because the tooling stayed quiet about it.
#
# Usage: bash scripts/check-node-version.sh   (sourced or called; never exits non-zero)

KNOWN_BAD="v24.15.0"

_nv="$(node --version 2>/dev/null || echo unknown)"

for _bad in $KNOWN_BAD; do
  if [ "$_nv" = "$_bad" ]; then
    echo "" >&2
    echo "  !! Node $_nv is a KNOWN-BAD build for this project." >&2
    echo "     It corrupts its own stack under load on Windows and the dev server dies" >&2
    echo "     mid-run with no error output (native 0xC0000409, silent by design)." >&2
    echo "     Measured here: 2 crashes in 3 e2e runs, vs 0 in 8 on v24.14.1." >&2
    echo "" >&2
    echo "     Fix: install any Node other than $_bad (v24.14.1 and the current 24.x LTS are" >&2
    echo "     both verified clean here), then restart the stack." >&2
    echo "     Details: docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md" >&2
    echo "" >&2
  fi
done

unset _nv _bad
