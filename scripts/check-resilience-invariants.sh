#!/usr/bin/env bash
# Enforces the mechanical half of the degraded-conditions contract (.claude/rules/resilience.md):
# the app must behave the same online, on lie-fi, hard offline, pinned offline, and against a
# backend that is cold-starting, DB-less, overloaded or mid-deploy. The way that stays true is by
# there being exactly ONE way to do each job -- one durable-write path, one connectivity signal,
# one ordering key, one HTTP client. A second way to do an existing job is the bug this catches.
#
# This exists for the same reason scripts/check-jdk-alignment.sh does: the repo accumulated 15
# incidents across only ~6 distinct mechanisms, because every invariant was advisory. Trusting
# review to catch a repeat is how the repeat happens. See docs/architecture/resilience.md.
#
# Like the JDK check, this FAILS CLOSED: if a pattern that is supposed to match known-good code
# suddenly matches nothing, the code moved and this script's assumptions rotted -- that is an
# error, not a pass.
#
# Run: bash scripts/check-resilience-invariants.sh
set -uo pipefail

cd "$(dirname "$0")/.."

FAILED=0
SRC="frontend/src"

fail() {
  FAILED=1
  echo "" >&2
  echo "FAIL: $1" >&2
}

# Product source only: no tests (they legitimately reach for internals), no build output.
product_files() {
  find "$SRC" -type f \( -name '*.js' -o -name '*.jsx' \) \
    ! -name '*.test.js' ! -name '*.test.jsx' ! -path "$SRC/test/*"
}

# One comment-stripped `path:line:code` index of all product source, built once.
#
# Built up front rather than per-check because this script runs on a Stop hook as well as in CI:
# the obvious shape (loop the files, sed+grep each one, for every check) spawns ~1500 processes and
# takes ~30s under Git Bash on Windows, which is far too slow to sit between every turn.
#
# Stripping `//` comments and `*` block-comment continuations matters because several of these
# patterns are discussed at length in explanatory comments -- navigator.onLine and submittedAt each
# appear in half a dozen -- and a comment mentioning a banned call is not a banned call.
INDEX=$(mktemp)
trap 'rm -f "$INDEX"' EXIT
product_files | tr '\n' '\0' | xargs -0 grep -nH '' \
  | sed -e 's%//.*%%' -e 's%^\([^:]*:[0-9]*:\)[[:space:]]*\*.*%\1%' > "$INDEX"

if [ ! -s "$INDEX" ]; then
  echo "check-resilience-invariants: built an empty source index for '$SRC'." >&2
  echo "The frontend source layout moved -- update this script rather than letting it pass." >&2
  exit 1
fi

# Matching index lines whose file is not in the sanctioned allowlist.
# Usage: violations <pattern> <allowed-file>...
violations() {
  local pattern="$1"; shift
  grep -E "$pattern" "$INDEX" | awk -F: -v allow="$(printf '%s\n' "$@")" '
    BEGIN { n = split(allow, A, "\n"); for (i = 1; i <= n; i++) if (A[i] != "") allowed[A[i]] = 1 }
    !($1 in allowed) { print "  " $0 }
  '
}

# Counts matches in one file, so a fail-closed sentinel can assert a sanctioned call site is still
# where this script thinks it is.
count_in() {
  grep -E "$1" "$INDEX" | awk -F: -v f="$2" '$1 == f' | wc -l | tr -d ' '
}

# Counts matches across the index, optionally restricted to (or excluding) a path prefix.
count_where() {
  local pattern="$1" mode="$2" prefix="$3"
  grep -E "$pattern" "$INDEX" | awk -F: -v m="$mode" -v p="$prefix" '
    { inside = (index($1, p) == 1) }
    (m == "under" && inside) || (m == "outside" && !inside) { c++ }
    END { print c + 0 }
  '
}

echo "check-resilience-invariants: verifying one-mechanism-per-job..."

# ---------------------------------------------------------------------------------------------
# 1. Durable writes go through the two enqueue choke points, both of which stamp enqueueSeq.
#    A bare useMutation skips that stamp, and ordering silently falls back to TanStack's
#    submittedAt -- which is what deadlocked the whole outbox twice (2026-07-29, 2026-08-01).
#    \b keeps this from matching useMutationState, which is a legitimate read-only API.
# ---------------------------------------------------------------------------------------------
OUT=$(violations '\buseMutation\b' "$SRC/hooks/useDurableMutation.js")
if [ -n "$OUT" ]; then
  fail "bare useMutation outside hooks/useDurableMutation.js"
  echo "$OUT" >&2
  echo "  -> Use useDurableMutation (component) or dispatchDurableWrite/enqueueOutboxWrite" >&2
  echo "     (non-component) so the write is stamped with an immutable enqueueSeq." >&2
  echo "     Online-only (Tier-3) writes use useGatedMutation instead." >&2
fi
if [ "$(count_in '\buseMutation\b' "$SRC/hooks/useDurableMutation.js")" -eq 0 ]; then
  fail "useDurableMutation.js no longer calls useMutation -- this check's assumption has rotted."
  echo "  -> The durable-write choke point moved. Update this script to match." >&2
fi

# ---------------------------------------------------------------------------------------------
# 2. One HTTP client. api/client.js is where the request timeout lives and where every outcome
#    feeds reachabilityMonitor -- a raw fetch elsewhere is invisible to lie-fi detection.
#    reachabilityProbe.js and config.js are deliberately outside it (documented in each).
#    \b keeps this from matching refetch(.
# ---------------------------------------------------------------------------------------------
OUT=$(violations '\bfetch\(' "$SRC/api/client.js" "$SRC/lib/reachabilityProbe.js" "$SRC/config.js")
if [ -n "$OUT" ]; then
  fail "raw fetch( outside the sanctioned HTTP paths"
  echo "$OUT" >&2
  echo "  -> Use api/client.js. A raw fetch never reports to reachabilityMonitor, so it cannot" >&2
  echo "     contribute to lie-fi detection, and it has no request timeout." >&2
fi
if [ "$(count_in '\bfetch\(' "$SRC/api/client.js")" -eq 0 ]; then
  fail "api/client.js no longer calls fetch( -- this check's assumption has rotted."
fi

# ---------------------------------------------------------------------------------------------
# 3. One connectivity signal. navigator.onLine is read in exactly one place (offlineMode.js, to
#    seed onlineManager on a boot-while-offline, since online/offline events never fire on initial
#    load). Everything else reads useOnlineStatus, so the manual pin is honoured.
# ---------------------------------------------------------------------------------------------
OUT=$(violations 'navigator\.onLine' "$SRC/lib/offlineMode.js")
if [ -n "$OUT" ]; then
  fail "navigator.onLine read outside lib/offlineMode.js"
  echo "$OUT" >&2
  echo "  -> Use useOnlineStatus (or onlineManager.isOnline() in non-React code). Reading" >&2
  echo "     navigator.onLine directly ignores the user's manual offline pin." >&2
fi
if [ "$(count_in 'navigator\.onLine' "$SRC/lib/offlineMode.js")" -eq 0 ]; then
  fail "offlineMode.js no longer reads navigator.onLine -- this check's assumption has rotted."
fi

# ---------------------------------------------------------------------------------------------
# 3b. Tier-3 (online-only) writes go through useGatedMutation, which is the only thing that should
#     reach for useRequireOnline directly. Every component that used to call it open-coded its own
#     error handling on top -- and most open-coded nothing, so a failed write vanished (Button
#     swallows a rejected onClick by design). OfflineDisabledWrap is unaffected: it greys out an
#     entry point, it does not perform the write.
# ---------------------------------------------------------------------------------------------
OUT=$(violations '\buseRequireOnline\b' "$SRC/hooks/useGatedMutation.js" "$SRC/hooks/useRequireOnline.js")
if [ -n "$OUT" ]; then
  fail "useRequireOnline used outside hooks/useGatedMutation.js"
  echo "$OUT" >&2
  echo "  -> Use useGatedMutation for a Tier-3 write: it composes the same gate and adds the" >&2
  echo "     pending flag and the error toast that every open-coded copy was missing." >&2
fi
if [ "$(count_in '\buseRequireOnline\b' "$SRC/hooks/useGatedMutation.js")" -eq 0 ]; then
  fail "useGatedMutation.js no longer uses useRequireOnline -- this check's assumption has rotted."
fi

# ---------------------------------------------------------------------------------------------
# 4. Ordering keys off the immutable enqueueSeq, never TanStack's submittedAt, which is re-stamped
#    to "now" on every re-execute. outboxSequence.js keeps one reference to it as a legacy
#    tie-break for entries queued before enqueueSeq existed. See 2026-08-01-outbox-reorder.
# ---------------------------------------------------------------------------------------------
OUT=$(violations 'submittedAt' "$SRC/lib/outboxSequence.js")
if [ -n "$OUT" ]; then
  fail "submittedAt referenced outside lib/outboxSequence.js"
  echo "$OUT" >&2
  echo "  -> Sort with byEnqueueOrder / read enqueueSeq. submittedAt is a framework timestamp" >&2
  echo "     re-stamped on every retry; keying off it re-deadlocked the outbox (2026-08-01)." >&2
fi

# ---------------------------------------------------------------------------------------------
# 5. Pinned counts. These are duplications we are actively removing, not invariants -- the pin
#    stops them GROWING while the refactor lands. Lower the number when you remove one; a count
#    below the pin is also an error, so the pin can never silently drift out of date.
# ---------------------------------------------------------------------------------------------
# Five legitimately-distinct triggers: online transition, tab visibility, and boot restore
# (App.jsx), plus login and confirmEmail (AuthContext.jsx). Each used to re-derive its own
# `if (onlineManager.isOnline())` gate; that precondition now lives inside flushOutbox alongside
# the auth-token one, so these are bare calls. The pin remains because a SIXTH trigger is a design
# decision -- when should a queued write be retried? -- and deserves to be noticed, not slipped in.
EXPECTED_FLUSH_CALLERS=5
ACTUAL_FLUSH_CALLERS=$(count_where '\bflushOutbox\(' outside "$SRC/lib/")
if [ "$ACTUAL_FLUSH_CALLERS" -ne "$EXPECTED_FLUSH_CALLERS" ]; then
  fail "flushOutbox() call-site count is $ACTUAL_FLUSH_CALLERS, pinned at $EXPECTED_FLUSH_CALLERS"
  violations '\bflushOutbox\(' >&2
  echo "  -> flushOutbox already self-gates on connectivity AND the auth token -- do not wrap a" >&2
  echo "     call site in its own precondition. If this is a genuinely new retry trigger, raise" >&2
  echo "     EXPECTED_FLUSH_CALLERS with a comment saying what it is; if you removed one, lower it." >&2
fi

# A swallowed rejection in the outbox machinery is invisible by construction -- 2026-08-01 named
# this class exactly: "an async dispatch mechanism must never have a code path where 'the task
# didn't run' and 'the task ran and nothing went wrong' are indistinguishable". Every current one
# is deliberate and commented; this pin stops an uncommented one being added.
# Matches the two deliberate-discard idioms: a binding-less `catch {` (not `catch (e) {`, which
# keeps the error and can log it) and an empty `.catch(() => {})` handler.
SWALLOW_RE='catch[[:space:]]*\{|\.catch\(\(\)[[:space:]]*=>[[:space:]]*\{[[:space:]]*\}\)'
# 2026-08-14: 33 -> 35. appStatePersistence.js moved from IndexedDB to localStorage so the write is
# durable at document teardown, which split its two storage try/catches into four: parse (a
# corrupt/truncated value), the localStorage read, the localStorage write, and the one-time legacy
# IndexedDB migration read. Each is commented in place; all four mean the same recoverable thing --
# "there is no restorable UI state", identical to a first-ever boot. None can hide a lost write:
# the write path reports failure through saveAppState's return value, which the migration checks
# before dropping the legacy copy.
EXPECTED_LIB_SWALLOWS=35
ACTUAL_LIB_SWALLOWS=$(count_where "$SWALLOW_RE" under "$SRC/lib/")
if [ "$ACTUAL_LIB_SWALLOWS" -gt "$EXPECTED_LIB_SWALLOWS" ]; then
  fail "silently-swallowed errors in $SRC/lib is $ACTUAL_LIB_SWALLOWS, above the pinned $EXPECTED_LIB_SWALLOWS"
  echo "  -> A new bare catch{} / .catch(()=>{}) in the offline machinery needs a comment saying" >&2
  echo "     why losing this error is safe. Then raise EXPECTED_LIB_SWALLOWS with that rationale." >&2
elif [ "$ACTUAL_LIB_SWALLOWS" -lt "$EXPECTED_LIB_SWALLOWS" ]; then
  echo "  note: swallowed-error count dropped to $ACTUAL_LIB_SWALLOWS (pinned $EXPECTED_LIB_SWALLOWS)." >&2
  echo "        Lower EXPECTED_LIB_SWALLOWS in this script to lock the improvement in." >&2
fi

# ---------------------------------------------------------------------------------------------
# 6. The documentation tiering CLAUDE.md describes but nothing enforced: every rule file must be
#    path-scoped (one without paths: loads on every request and defeats the tiering), and
#    CLAUDE.md itself must stay small -- it reached 84 KB once, and a bloated CLAUDE.md causes
#    real instructions to be ignored.
# ---------------------------------------------------------------------------------------------
for rule in .claude/rules/*.md; do
  if ! head -3 "$rule" | grep -q '^paths:'; then
    fail "$rule has no paths: frontmatter -- it would load on every request"
    echo "  -> Add paths: frontmatter scoping it to the files it applies to." >&2
  fi
done

CLAUDE_MD_MAX=250
CLAUDE_MD_LINES=$(wc -l < CLAUDE.md | tr -d ' ')
if [ "$CLAUDE_MD_LINES" -gt "$CLAUDE_MD_MAX" ]; then
  fail "CLAUDE.md is $CLAUDE_MD_LINES lines, over the $CLAUDE_MD_MAX ceiling it sets for itself"
  echo "  -> Route the detail to .claude/rules/*.md, docs/architecture/, or docs/incidents/." >&2
fi

if [ "$FAILED" -ne 0 ]; then
  echo "" >&2
  echo "The contract: one code path for every condition, one mechanism per job." >&2
  echo "Checklist and the register of sanctioned divergences: .claude/rules/resilience.md" >&2
  exit 1
fi

echo "check-resilience-invariants: OK ($CLAUDE_MD_LINES-line CLAUDE.md, $ACTUAL_FLUSH_CALLERS flush caller(s), $ACTUAL_LIB_SWALLOWS commented swallow(s) in lib/)."
