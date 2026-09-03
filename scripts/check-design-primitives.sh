#!/usr/bin/env bash
#
# Guards the ONE rule in .claude/rules/frontend-core.md that has already been lost once:
# "reach for a primitive before writing a style object."
#
# It was lost quietly rather than dramatically. PR #151 shipped Card, Input, SectionLabel and
# EmptyState with a documented rule saying to use them; nothing enforced it; and by the time anyone
# looked, the app had SIX different renderings of the same uppercase section label -- 13px/700,
# 12px/700, 11px/700, --text-xs/600, --text-2xs/600 and --text-2xs/700 -- so which one you saw
# depended on which screen you were on. `ExerciseRecordsTable` had even declared a LOCAL component
# called `SectionLabel`, shadowing the shared one.
#
# A rule that is only written down decays into a rule nobody follows. This is the cheap mechanical
# half, in the same spirit as check-resilience-invariants.sh: it cannot judge whether a given style
# object is tasteful, only whether someone has re-typed a recipe a primitive already owns.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="frontend/src"
fail=0

note() { printf '  %s\n' "$1"; }

echo "check-design-primitives: verifying the primitives are actually used..."

# ── 1. The uppercase section label ────────────────────────────────────────────
#
# Every file below re-implements the recipe for a REASON, and each reason is a different element
# rather than a different taste. Anything not on this list should be <SectionLabel>.
#
#   admin/*, routes/admin/*   design-system.md: the admin portal is deliberately not migrated
#                             (separate chrome, internal-facing)
#   ExerciseDetail            `cardLabelStyle` is a denser in-card tier (--text-2xs); a label
#                             inside a summary card, not a heading above a section
#   HistoryWindowModal        `benefitsTitleStyle` is a decorated heading that carries the Huddle
#                             mark inline (display:flex + gap), not a plain label
#   PRCelebration             a caption under the 1RM figure in the celebration overlay
#   routes/*Page, ContactTab  FIELD labels on <label htmlFor>, which merely share the same tokens.
#                             Different semantics: a form control's name, not a section heading.
LABEL_ALLOWED='components/admin/|routes/admin/|components/log/ExerciseDetail.jsx|components/shared/HistoryWindowModal.jsx|components/shared/PRCelebration.jsx|components/contact/ContactTab.jsx|routes/[A-Za-z]*Page.jsx'

label_offenders=$(grep -rln "textTransform: 'uppercase'" --include='*.jsx' "$SRC" \
  | grep -v '\.test\.jsx$' \
  | sed "s|^$SRC/||" \
  | grep -Ev "$LABEL_ALLOWED" || true)

if [ -n "$label_offenders" ]; then
  echo "FAIL: these re-implement the uppercase section label instead of using <SectionLabel>:"
  printf '%s\n' "$label_offenders" | while read -r f; do note "$f"; done
  note ""
  note "Use components/shared/SectionLabel.jsx. If this really is a different element,"
  note "add it to LABEL_ALLOWED above WITH the reason, the way the existing entries do."
  fail=1
fi

# ── 2. No second component may shadow a shared primitive's name ───────────────
#
# ExerciseRecordsTable declared `function SectionLabel(...)` locally while the shared one existed,
# so the app had two components of that name rendering at different sizes. A local wrapper is fine
# -- it just may not take the primitive's name (see RecordsSectionLabel).
for primitive in Button Card Input TextArea SectionLabel EmptyState IconButton Modal Skeleton; do
  shadows=$(grep -rln "^function $primitive(\|^const $primitive = (" --include='*.jsx' "$SRC" \
    | grep -v "$SRC/components/shared/$primitive.jsx" \
    | grep -v '\.test\.jsx$' || true)
  if [ -n "$shadows" ]; then
    echo "FAIL: '$primitive' is a shared primitive, but a local component shadows that name:"
    printf '%s\n' "$shadows" | while read -r f; do note "$f"; done
    note "Rename the local one (e.g. RecordsSectionLabel) so the import is unambiguous."
    fail=1
  fi
done

# ── 3. --color-faint is not a text colour ────────────────────────────────────
#
# 2.07:1 -- it fails even the 3:1 bar for control boundaries, let alone AA for text. It is for
# dividers, inactive glyphs and dashed borders. Matched narrowly (`color:` immediately followed by
# the token) so `borderColor`/`background` uses do not trip it.
#
# Lines carrying an <Icon…> are skipped: an inactive GLYPH is one of the sanctioned uses, and
# ExerciseDetail's pinned-note IconPin is exactly that. This is the one place the check cannot tell
# text from furniture on syntax alone, so it defers rather than nagging about a correct use.
faint=$(grep -rn "[^a-zA-Z-]color: 'var(--color-faint)'" --include='*.jsx' "$SRC" \
  | grep -v '\.test\.jsx:' \
  | grep -v 'components/admin/' \
  | grep -v 'routes/admin/' \
  | grep -v '<Icon' || true)

if [ -n "$faint" ]; then
  echo "FAIL: --color-faint used as a text colour (2.07:1 -- see frontend-core.md):"
  printf '%s\n' "$faint" | while read -r line; do note "${line#"$SRC"/}"; done
  note "Body copy and labels use --color-muted. --color-faint is furniture only."
  fail=1
fi

# -- 4. The weight scale tops out at 700 --------------------------------------
#
# design-system.md retires 800 explicitly. The type pass existed because `fontWeight: 700` appeared
# 132 times and `400` three, so every string was bold and nothing stood out -- a weight ABOVE the
# top of the scale is that same mistake one step further on. --weight-bold is the ceiling.
heavy=$(grep -rn "fontWeight: 800\|font-weight: 800" --include='*.jsx' --include='*.css' "$SRC" \
  | grep -v '\.test\.jsx:' \
  | grep -v 'components/admin/' \
  | grep -v 'routes/admin/' || true)

if [ -n "$heavy" ]; then
  echo "FAIL: fontWeight 800 is retired (design-system.md) -- --weight-bold (700) is the ceiling:"
  printf '%s\n' "$heavy" | while read -r line; do note "${line#"$SRC"/}"; done
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "check-design-primitives: FAILED"
  exit 1
fi

echo "check-design-primitives: OK (section labels, primitive shadowing, --color-faint as text, weight ceiling)."
