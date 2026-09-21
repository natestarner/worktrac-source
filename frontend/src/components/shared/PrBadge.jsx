import { IconTrophy, IconChevronsUp, IconLayers } from './icons';
import { prSpec } from '../trends/exerciseMetrics';

// The one badge for "this took a record", used by History's set pills, History's exercise entry
// headers and the celebration overlay. One component so a top-weight record cannot look like one
// thing on History and another in the overlay.
//
// ## The GLYPH carries the meaning. There is exactly one record colour.
//
// Each record type gets its own glyph and its own accessible label, and those are the ONLY things
// that distinguish the types. There were three --color-pr-<tone>-* trios here, and they earned
// their removal twice over: measured mutual separation between the three text tones was
// 1.05:1 - 1.43:1 (one colour to a red-green colour-blind reader, or to anyone glancing at a phone
// in a bright gym), and each of them sat on top of an ALERT fill -- the est.-1RM tint was CIEDE2000
// 2.21 from --color-danger-bg, below the just-noticeable-difference threshold. A personal record
// was being drawn in the error colour. See index.css's --color-record-* block for the derivation.
//
// So: don't reintroduce a per-type tint. If two record types need to be told apart, that is a
// glyph problem or a label problem. The acceptance test is unchanged -- view History in greyscale
// and confirm the three types are still tellable apart.
//
// ## Naming
//
// The label keeps the words "personal record" in it, with the type appended. ~40 e2e assertions
// and parity-pr-record.spec.ts select on the existing phrasing, so APPENDING preserves every one
// of them where a rewrite would break them all. Note parity-pr-record.spec.ts's standing warning
// that getByLabel('Record') needs { exact: true } against these.

const GLYPHS = {
  est1rm: IconTrophy,
  heaviest: IconChevronsUp,
  sessionVolume: IconLayers,
};

// Falls back to the est.-1RM glyph rather than throwing, the same rule metricSpec exists for: a
// persisted UI slice or a restored cache can name a measure this build does not know.
export function prBadgeGlyph(type) {
  return GLYPHS[type] || IconTrophy;
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

// The same name, sentence-cased for a `title` tooltip. Two call sites render this badge with a
// hover title (History's set pills and the Log screen's set rows) and they must not each own a
// copy of the capitalisation, or one of them drifts.
export function prBadgeTitle(types, set) {
  const label = prBadgeLabel(types, set);
  return label.charAt(0).toUpperCase() + label.slice(1);
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
  const spec = prSpec(type);
  const text = label ?? spec?.badgeLabel;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showLabel ? 'var(--space-1)' : 0,
        color: 'var(--color-record-text)',
        background: showLabel ? 'var(--color-record-bg)' : 'transparent',
        border: showLabel ? '1px solid var(--color-record-border)' : 'none',
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
