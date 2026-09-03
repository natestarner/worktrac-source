import { formatDateLabel, formatRestTime } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import Skeleton from '../shared/Skeleton';
import SectionLabel from '../shared/SectionLabel';

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
const dateStyle = { color: 'var(--color-muted)', fontSize: 12, fontWeight: 400, marginLeft: 6 };

function Row({ label, value, date, empty }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={empty ? { ...valueStyle, color: 'var(--color-muted)', fontWeight: 400 } : valueStyle}>
        {value}
        {date && <span style={dateStyle}>{formatDateLabel(date)}</span>}
      </span>
    </div>
  );
}

// The shared primitive, with only the spacing this table needs. It was previously a LOCAL component
// of the same name, shadowing the import -- so the app had two `SectionLabel`s that rendered at
// different sizes and weights, and which one you got depended on which file you were reading.
function RecordsSectionLabel({ children }) {
  return <SectionLabel style={{ margin: 'var(--space-4) 0 var(--space-1)' }}>{children}</SectionLabel>;
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

  // Same call as bodyweightOnly below, one measure over: a hold carries 0 reps, so every
  // weight- and rep-based record is 0 and a column of zeros is worse than no column. The two
  // records that mean anything are the longest hold and the heaviest load held -- kept separate
  // rather than fused into one load-adjusted score, exactly as heaviest weight sits beside
  // est. 1RM. Mirrors ExerciseRecordsDto.durationTracked.
  if (records.durationTracked) {
    return (
      <div style={{ marginTop: 8 }}>
        <RecordsSectionLabel>Records &middot; holds</RecordsSectionLabel>
        <Row
          label="Longest hold"
          value={
            records.longestHold.weightLb > 0
              ? `${formatRestTime(records.longestHold.durationSeconds)} @ ${w(records.longestHold.weightLb)} ${defaultUnit}`
              : formatRestTime(records.longestHold.durationSeconds)
          }
          date={records.longestHold.date}
        />
        {/* Only worth a row once something was actually loaded -- otherwise it just restates the
            longest hold at 0 lb. */}
        {records.heaviestLoadHeld?.weightLb > 0 && (
          <Row
            label="Heaviest load held"
            value={`${w(records.heaviestLoadHeld.valueLb)} ${defaultUnit} × ${formatRestTime(records.heaviestLoadHeld.durationSeconds)}`}
            date={records.heaviestLoadHeld.date}
          />
        )}
        <Row label="Total time under tension" value={formatRestTime(records.totalHoldSeconds)} />
        <Row label="Total sets" value={records.totalSets} />
      </div>
    );
  }

  // Every weight-based record is 0 for an exercise never loaded (pull-ups, push-ups) -- and an
  // est. 1RM there is a rep count wearing a costume. Reps are the real record, so that's all we
  // show. Mirrors ExerciseRecordsDto.bodyweightOnly / StatsService#comparableLb.
  if (records.bodyweightOnly) {
    return (
      <div style={{ marginTop: 8 }}>
        <RecordsSectionLabel>Records &middot; bodyweight</RecordsSectionLabel>
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
      <RecordsSectionLabel>All-time bests</RecordsSectionLabel>
      {/* Epley-estimated, so this legitimately disagrees with "Heaviest weight" below it: a
          185 lb x 8 estimates to ~234 lb and outranks a 225 lb x 1 single. That disagreement is
          the reason both rows exist -- the qualifier names the set the estimate came from, so a
          number that beats your best actual lift doesn't read as a bug. Guarded because the
          backend sends null when every set is bodyweight. */}
      {records.bestEst1rm && (
        <Row
          label="Best est. 1RM"
          value={`${w(records.bestEst1rm.valueLb)} ${defaultUnit} (${w(records.bestEst1rm.weightLb)} ${defaultUnit} × ${records.bestEst1rm.reps})`}
          date={records.bestEst1rm.date}
        />
      )}
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

      <RecordsSectionLabel>Lifetime</RecordsSectionLabel>
      <Row label="Total sets" value={records.totalSets} />
      <Row label="Total reps" value={records.totalReps} />
      <Row label="Total volume" value={`${Math.round(w(records.totalVolumeLb))} ${defaultUnit}`} />
    </div>
  );
}
