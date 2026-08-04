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

export default function SetPillRow({ sets, style }) {
  if (!sets?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, ...style }}>
      {sets.map((s, i) => (
        <span key={s.id ?? i} style={pillStyle}>
          {formatSet(s)}
        </span>
      ))}
    </div>
  );
}
