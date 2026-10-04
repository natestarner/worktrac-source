import { formatSet } from '../../utils/formatSet';
import PrBadge, { prBadgeLabel } from './PrBadge';

// The pills are classes in index.css (.set-pill), not style objects: History draws thousands of
// them, and React applies an inline style one property at a time.
//
// A pill that took a record carries the one record tint (.set-pill--record) and one glyph PER
// record it took.
//
// ⚠️ The glyphs, not the tint, are what tell the types apart -- there is only one tint now, so
// this is no longer a caveat but the whole mechanism. It used to be tinted by the FIRST record in
// precedence order, which meant a set taking both top weight and est. 1RM had to pick one costume;
// worse, the three tints were 1.05:1 - 1.43:1 from each other AND sat on top of the alert palette
// (the est.-1RM fill was CIEDE2000 2.21 from --color-danger-bg, i.e. below the just-noticeable
// -difference threshold). See PrBadge.jsx and index.css's --color-record-* block.

// prMarks is an optional array of PR-TYPE ARRAYS index-aligned to `sets` (see historyPrFlags.js).
// Omitting it (every non-History call site) renders a plain pill, exactly as before.
//
// The accessible name keeps the words "personal record" and appends the types
// ("135lb x 8, personal record: top weight"). ~40 e2e assertions and parity-pr-record.spec.ts
// select on the existing phrasing, so appending preserves every one of them where a rewrite would
// break them all. Note parity-pr-record.spec.ts's standing warning that getByLabel('Record')
// needs { exact: true } against these.
//
// `collapseRuns` folds consecutive identical sets into one pill with a leading count
// ("4×105lb×10"), the way the PRs board reads a session-volume record's sets. Only for a caller
// that passes no prMarks: a run has no single set to carry a mark.
export default function SetPillRow({ sets, prMarks, style, collapseRuns = false }) {
  if (!sets?.length) return null;
  if (collapseRuns) {
    return (
      <div className="set-pill-row" style={style}>
        {toRuns(sets).map(({ set, count }, i) => {
          const text = formatSet(set);
          return (
            <span key={i} className="set-pill">
              {count > 1 ? `${count}×${text}` : text}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <div className="set-pill-row" style={style}>
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
            className={isPr ? 'set-pill set-pill--record' : 'set-pill'}
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

// Consecutive sets that read the same are one run. Keyed on the formatted text, so "the same" is
// exactly "would draw the same pill".
function toRuns(sets) {
  const runs = [];
  for (const set of sets) {
    const last = runs[runs.length - 1];
    if (last && formatSet(last.set) === formatSet(set)) last.count += 1;
    else runs.push({ set, count: 1 });
  }
  return runs;
}
