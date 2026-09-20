import { IconStarFilled, IconChevronsUp, IconLayers } from './icons';
import { prSpec } from '../trends/exerciseMetrics';

// The one badge for "this took a record", used by History's set pills, History's exercise entry
// headers and the celebration overlay. One component so a top-weight record cannot look like one
// thing on History and another in the overlay.
//
// ## Shape carries the meaning; colour reinforces it
//
// Each PR type gets its own GLYPH and its own accessible label, and those are what distinguish the
// types. The --color-pr-<tone>-* trios are deliberately a second signal only: measured mutual
// separation between the three text tones is 1.05:1 - 1.43:1, so to a red-green colour-blind
// reader -- or anyone glancing at a phone in a bright gym -- they are one colour. The acceptance
// test is to view History in greyscale and confirm the types are still tellable apart.
//
// The tones come from the mark's own three warms (orange / rust / amber), the family the confetti
// already uses. Picking blue/green/purple would have separated them far more cheaply and read as a
// different app bolted on; index.css's toast comment makes the same argument about green, and the
// confetti's middle colour WAS green once and was removed for exactly this reason.
//
// ## Naming
//
// The label keeps the words "personal record" in it, with the type appended. ~40 e2e assertions
// and parity-pr-record.spec.ts select on the existing phrasing, so APPENDING preserves every one
// of them where a rewrite would break them all. Note parity-pr-record.spec.ts's standing warning
// that getByLabel('Record') needs { exact: true } against these.

const GLYPHS = {
  est1rm: IconStarFilled,
  heaviest: IconChevronsUp,
  sessionVolume: IconLayers,
};

// Falls back to the est.-1RM glyph rather than throwing, the same rule metricSpec exists for: a
// persisted UI slice or a restored cache can name a measure this build does not know.
export function prBadgeGlyph(type) {
  return GLYPHS[type] || IconStarFilled;
}

export function prBadgeTone(type) {
  return prSpec(type)?.tone || 'est1rm';
}

// ⚠️ What to CALL the est.-1RM record for a given set, which is not always "Est. 1RM".
//
// comparableValue substitutes a rep count at weight 0 and seconds for a hold, so that name is
// wrong for a pull-up and wrong for a plank. .claude/rules/trends.md is explicit: name all three
// cases, or name none. These are the words the records table already uses.
//
// One derivation, two consumers -- the celebration overlay's row label and History's accessible
// name. They must agree: the same record cannot be "Longest hold" in the overlay and "est. 1rm"
// on the History row it produced.
export function est1rmLabelForSet(set) {
  if (set?.durationSeconds != null) return 'Longest hold';
  if (Number(set?.weight) === 0) return 'Most reps';
  return 'Est. 1RM';
}

// "personal record: top weight" -- see the naming note above.
//
// `set` is optional but should be passed wherever it is known: without it the est.-1RM record
// falls back to the spec's generic name, which is the costume problem above.
export function prBadgeLabel(types, set) {
  const names = (types || [])
    .map((t) => (t === 'est1rm' && set ? est1rmLabelForSet(set) : prSpec(t)?.badgeLabel))
    .filter(Boolean);
  if (names.length === 0) return 'personal record';
  return 'personal record: ' + names.join(', ').toLowerCase();
}

// A single type's badge. `size` matches the surrounding text's optical weight; History's set pills
// pass 12 and the overlay passes 14 with a label.
//
// ⚠️ `label` OVERRIDES the spec's name, and it exists for one reason: the est.-1RM measure is a
// rep count at weight 0 and seconds for a hold, so labelling a pull-up record "Est. 1RM" is the
// "rep count wearing a costume" mistake .claude/rules/trends.md exists to prevent -- and that rule
// is explicit that you name all three cases or none. Only the caller knows which case a given set
// is (it already splits three ways to build the caption), so the caller supplies the word.
export default function PrBadge({ type, size = 12, showLabel = false, label }) {
  const Glyph = prBadgeGlyph(type);
  const tone = prBadgeTone(type);
  const spec = prSpec(type);
  const text = label ?? spec?.badgeLabel;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showLabel ? 'var(--space-1)' : 0,
        color: 'var(--color-pr-' + tone + '-text)',
        background: showLabel ? 'var(--color-pr-' + tone + '-bg)' : 'transparent',
        border: showLabel ? '1px solid var(--color-pr-' + tone + '-border)' : 'none',
        borderRadius: 'var(--radius-full)',
        padding: showLabel ? 'var(--space-1) var(--space-2)' : 0,
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-bold)',
        lineHeight: 1,
      }}
    >
      <Glyph size={size} />
      {showLabel && text}
    </span>
  );
}
