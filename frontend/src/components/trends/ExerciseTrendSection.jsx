import { useEffect } from 'react';
import { usePrs } from '../../hooks/usePrs';
import { useExerciseTrend } from '../../hooks/useExerciseTrend';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import ExerciseTrendChart from './ExerciseTrendChart';
import Skeleton from '../shared/Skeleton';

// 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
const selectStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  fontSize: 16,
  fontWeight: 600,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  marginBottom: 16,
};

export default function ExerciseTrendSection({ personId, exerciseId, onSelectExercise, weeks, defaultUnit }) {
  // Same cached PR list the PR board reads (queryKeys.prs), so the dropdown can't diverge from it.
  const { prs: loggedExercises } = usePrs(personId);

  // Default the dropdown to the first exercise once the list has loaded and none is selected yet.
  useEffect(() => {
    if (!exerciseId && loggedExercises.length > 0) {
      onSelectExercise(loggedExercises[0].exerciseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedExercises, exerciseId]);

  const { points, loading } = useExerciseTrend(personId, exerciseId, weeks);

  if (loggedExercises.length === 0) {
    return null;
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', marginBottom: 12 }}>Exercise progress &middot; est. 1RM</div>

      <select value={exerciseId || ''} onChange={(e) => onSelectExercise(Number(e.target.value))} style={selectStyle}>
        {loggedExercises.map((pr) => (
          <option key={pr.exerciseId} value={pr.exerciseId}>
            {pr.exerciseName}
          </option>
        ))}
      </select>

      {loading && <Skeleton width="100%" height={200} radius={8} />}
      {!loading && <ExerciseTrendChart points={points} defaultUnit={defaultUnit} />}

      {points.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {points
            .slice()
            .reverse()
            .map((p) => (
              <div
                key={p.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-subtle-bg)',
                  fontSize: 14,
                }}
              >
                <span style={{ color: 'var(--color-muted)' }}>{formatDateLabel(p.date)}</span>
                <span style={{ fontWeight: 600 }}>
                  {convertWeight(p.weightLb, 'lb', defaultUnit)} {defaultUnit} &times; {p.reps}
                </span>
                {p.isPr && (
                  <span
                    style={{
                      background: 'var(--color-success-bg)',
                      color: 'var(--color-success)',
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: 999,
                      letterSpacing: '0.03em',
                    }}
                  >
                    PR
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
