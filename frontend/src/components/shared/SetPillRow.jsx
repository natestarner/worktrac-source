import { formatSet } from '../../utils/formatSet';
import PrBadge, { prBadgeLabel, prBadgeTone } from './PrBadge';

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 9px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  fontSize: 13,
  fontWeight: 400,
};

// A pill that took a record is tinted by the FIRST record it took (precedence order, so top
// weight wins over est. 1RM when a set takes both) and carries one glyph per record.
//
// ⚠️ The glyphs, not the tint, are what tell the types apart. The three --color-pr-*-text tones
// are 1.05:1 - 1.43:1 from each other, i.e. one colour to a red-green colour-blind reader or to
// anyone glancing at a phone in a bright gym. Colour alone was never accessible here -- that is
// why the original single marker already paired a star with an aria-label -- and three colours
// does not change the argument, it sharpens it. See PrBadge.jsx.
function prPillStyle(tone) {
  return {
    ...pillStyle,
    background: 'var(--color-pr-' + tone + '-bg)',
    color: 'var(--color-pr-' + tone + '-text)',
    fontWeight: 700,
  };
}

// prMarks is an optional array of PR-TYPE ARRAYS index-aligned to `sets` (see historyPrFlags.js).
// Omitting it (every non-History call site) renders a plain pill, exactly as before.
//
// The accessible name keeps the words "personal record" and appends the types
// ("135lb x 8, personal record: top weight"). ~40 e2e assertions and parity-pr-record.spec.ts
// select on the existing phrasing, so appending preserves every one of them where a rewrite would
// break them all. Note parity-pr-record.spec.ts's standing warning that getByLabel('Record')
// needs { exact: true } against these.
export default function SetPillRow({ sets, prMarks, style }) {
  if (!sets?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, ...style }}>
      {sets.map((s, i) => {
        const types = prMarks?.[i] || [];
        const isPr = types.length > 0;
        const text = formatSet(s);
        const label = isPr ? prBadgeLabel(types) : undefined;
        return (
          <span
            key={s.id ?? i}
            style={isPr ? prPillStyle(prBadgeTone(types[0])) : pillStyle}
            title={label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined}
            aria-label={isPr ? `${text}, ${label}` : undefined}
          >
            {types.map((type) => (
              <PrBadge key={type} type={type} size={12} />
            ))}
            {text}
          </span>
        );
      })}
    </div>
  );
}
