import { formatSet } from '../../utils/formatSet';

const pillStyle = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  fontSize: 13,
  fontWeight: 400,
};

// Color alone isn't accessible, so a PR pill also gets a leading star glyph and its own
// aria-label -- the star is aria-hidden (decorative) and the label carries the full meaning for
// screen readers instead of relying on the visual diff from a plain pill.
const prPillStyle = {
  ...pillStyle,
  background: 'var(--color-success-bg)',
  color: 'var(--color-success)',
  fontWeight: 700,
};

// prFlags is an optional array of booleans index-aligned to `sets` (see historyPrFlags.js) --
// omitting it (every existing call site) renders byte-identical output to before.
export default function SetPillRow({ sets, prFlags, style }) {
  if (!sets?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, ...style }}>
      {sets.map((s, i) => {
        const isPr = !!prFlags?.[i];
        const text = formatSet(s);
        return (
          <span
            key={s.id ?? i}
            style={isPr ? prPillStyle : pillStyle}
            title={isPr ? 'Personal record' : undefined}
            aria-label={isPr ? `${text}, personal record` : undefined}
          >
            {isPr && <span aria-hidden="true">&#9733; </span>}
            {text}
          </span>
        );
      })}
    </div>
  );
}
