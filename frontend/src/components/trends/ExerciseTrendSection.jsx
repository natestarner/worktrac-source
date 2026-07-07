import { useEffect, useState } from 'react';
import { getPrs } from '../../api/stats';
import { useExerciseTrend } from '../../hooks/useExerciseTrend';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import ExerciseTrendChart from './ExerciseTrendChart';

const selectStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 600,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  marginBottom: 16,
};

export default function ExerciseTrendSection({ personId, exerciseId, onSelectExercise, weeks, defaultUnit }) {
  const [loggedExercises, setLoggedExercises] = useState([]);

  useEffect(() => {
    if (!personId) return;
    getPrs(personId).then((prs) => {
      setLoggedExercises(prs);
      if (!exerciseId && prs.length > 0) {
        onSelectExercise(prs[0].exerciseId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

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
