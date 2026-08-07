import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import Skeleton from '../shared/Skeleton';

// All-time bests for the selected exercise. This is the one part of Trends meant to be consulted
// mid-workout ("what have I done for 5+ before?"), so it stays a plain readable table rather than
// another plot.

const rowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 0',
  borderBottom: '1px solid var(--color-subtle-bg)',
  fontSize: 14,
};

const labelStyle = { color: 'var(--color-muted)' };
const valueStyle = { fontWeight: 600, textAlign: 'right' };
const dateStyle = { color: 'var(--color-faint)', fontSize: 12, fontWeight: 400, marginLeft: 6 };

function Row({ label, value, date, empty }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={empty ? { ...valueStyle, color: 'var(--color-faint)', fontWeight: 400 } : valueStyle}>
        {value}
        {date && <span style={dateStyle}>{formatDateLabel(date)}</span>}
      </span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--color-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        margin: '16px 0 4px',
      }}
    >
      {children}
    </div>
  );
}

export default function ExerciseRecordsTable({ records, loading, defaultUnit }) {
  if (loading) {
    return (
      <div style={{ marginTop: 16 }}>
        <Skeleton width={90} height={11} style={{ marginBottom: 10 }} />
        <Skeleton width="100%" height={120} radius={8} />
      </div>
    );
  }
  if (!records || records.totalSets === 0) {
    return null;
  }

  const w = (lb) => convertWeight(lb, 'lb', defaultUnit);

  // Every weight-based record is 0 for an exercise never loaded (pull-ups, push-ups) -- a rep-max
  // table there is a column of zeros pretending to be information. Reps are the real record, so
  // that's all we show. Mirrors ExerciseRecordsDto.bodyweightOnly / StatsService#comparableLb.
  if (records.bodyweightOnly) {
    return (
      <div style={{ marginTop: 8 }}>
        <SectionLabel>Records &middot; bodyweight</SectionLabel>
        <Row
          label="Most reps in a set"
          value={`${records.mostReps.reps} reps`}
          date={records.mostReps.date}
        />
        <Row label="Total reps" value={`${records.totalReps} reps`} />
        <Row label="Total sets" value={records.totalSets} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <SectionLabel>Rep maxes</SectionLabel>
      {records.repMaxes.map((rm) => (
        <Row
          key={rm.repTarget}
          label={`${rm.repTarget}+ reps`}
          value={rm.weightLb === null ? 'Not yet' : `${w(rm.weightLb)} ${defaultUnit} × ${rm.reps}`}
          date={rm.weightLb === null ? null : rm.date}
          empty={rm.weightLb === null}
        />
      ))}

      <SectionLabel>All-time bests</SectionLabel>
      <Row
        label="Heaviest weight"
        value={`${w(records.heaviestWeight.valueLb)} ${defaultUnit} × ${records.heaviestWeight.reps}`}
        date={records.heaviestWeight.date}
      />
      <Row
        label="Best set volume"
        value={`${Math.round(w(records.bestSetVolume.valueLb))} ${defaultUnit}`}
        date={records.bestSetVolume.date}
      />
      <Row
        label="Best session volume"
        value={`${Math.round(w(records.bestSessionVolume.valueLb))} ${defaultUnit}`}
        date={records.bestSessionVolume.date}
      />
      <Row
        label="Most reps in a set"
        // "8 @ 260 lb", not the app's usual "260 lb × 8" -- this row's subject is the rep count, and
        // the weight is the qualifier. Written out as "reps" because a bare "8 × 260 lb" reads
        // backwards next to the weight-first rows above it.
        value={`${records.mostReps.reps} reps @ ${w(records.mostReps.weightLb)} ${defaultUnit}`}
        date={records.mostReps.date}
      />

      <SectionLabel>Lifetime</SectionLabel>
      <Row label="Total sets" value={records.totalSets} />
      <Row label="Total reps" value={records.totalReps} />
      <Row label="Total volume" value={`${Math.round(w(records.totalVolumeLb))} ${defaultUnit}`} />
    </div>
  );
}
