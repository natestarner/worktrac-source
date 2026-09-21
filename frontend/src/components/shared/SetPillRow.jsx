import { formatSet } from '../../utils/formatSet';
import PrBadge, { prBadgeLabel } from './PrBadge';

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

// A pill that took a record carries the one record tint and one glyph PER record it took.
//
// ⚠️ The glyphs, not the tint, are what tell the types apart -- there is only one tint now, so
// this is no longer a caveat but the whole mechanism. It used to be tinted by the FIRST record in
// precedence order, which meant a set taking both top weight and est. 1RM had to pick one costume;
// worse, the three tints were 1.05:1 - 1.43:1 from each other AND sat on top of the alert palette
// (the est.-1RM fill was CIEDE2000 2.21 from --color-danger-bg, i.e. below the just-noticeable
// -difference threshold). See PrBadge.jsx and index.css's --color-record-* block.
const prPillStyle = {
  ...pillStyle,
  background: 'var(--color-record-bg)',
  color: 'var(--color-record-text)',
  fontWeight: 700,
};

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
        // The SET is passed so an est.-1RM record on a pull-up reads "most reps" and on a plank
        // "longest hold", not "est. 1rm" -- see est1rmLabelForSet.
        const label = isPr ? prBadgeLabel(types, s) : undefined;
        return (
          <span
            key={s.id ?? i}
            style={isPr ? prPillStyle : pillStyle}
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
