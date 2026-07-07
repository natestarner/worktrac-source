import { useEffect, useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { getPrs } from '../../api/stats';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';

export default function PRsTab() {
  const { activePersonId } = useAppState();
  const { people } = useAuth();
  const [prs, setPrs] = useState([]);
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  useEffect(() => {
    if (!activePersonId) return;
    getPrs(activePersonId).then(setPrs);
  }, [activePersonId]);

  if (prs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
        No PRs yet for {activePersonName} &mdash; log a set to start the board.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {prs.map((pr) => (
        <div
          key={pr.exerciseId}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{pr.exerciseName}</div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
              {pr.category} &middot; {formatDateLabel(toLocalDateStr(pr.best.sessionStartedAt))}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-pr-text)' }}>
              {pr.best.est1rm} {pr.best.unit}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
              {pr.best.weight}
              {pr.best.unit}×{pr.best.reps}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
