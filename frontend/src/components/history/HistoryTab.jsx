import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { downloadPersonCsv } from '../../api/export';
import { formatDateLabel, formatTime, toLocalDateStr } from '../../utils/datetime';
import PastSessionModal from './PastSessionModal';
import Button from '../shared/Button';

function timeLabelFor(session) {
  if (session.endedAt === null) return `${formatTime(session.startedAt)} · In progress`;
  if (session.endedAt !== session.startedAt) return `${formatTime(session.startedAt)}–${formatTime(session.endedAt)}`;
  return formatTime(session.startedAt);
}

export default function HistoryTab() {
  const navigate = useNavigate();
  const { activePersonId, startEditingSession } = useAppState();
  const { people } = useAuth();
  const { history } = useHistory(activePersonId);
  const [showPastSessionModal, setShowPastSessionModal] = useState(false);

  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  function handleEdit(session) {
    startEditingSession(session);
    navigate('/app/log');
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <button onClick={() => setShowPastSessionModal(true)} style={secondaryButtonStyle}>
          + Log a past workout
        </button>
        <Button onClick={() => downloadPersonCsv(activePersonId)} style={outlineButtonStyle}>
          Export data
        </Button>
      </div>

      {history.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
          No workouts logged yet for {activePersonName}.
        </div>
      )}

      {history.map((session) => (
        <div key={session.sessionId} style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-muted)' }}>
              {formatDateLabel(toLocalDateStr(session.startedAt))} &middot; {timeLabelFor(session)}
            </div>
            <button onClick={() => handleEdit(session)} style={editLinkStyle}>
              Edit
            </button>
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
            {session.entries.map((entry, i) => (
              <div key={entry.exerciseId} style={{ padding: '14px 0', borderBottom: i < session.entries.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{entry.exerciseName}</div>
                <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                  {entry.sets.map((s) => `${s.weight}${s.unit || 'lb'}×${s.reps}`).join('   ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {showPastSessionModal && <PastSessionModal onClose={() => setShowPastSessionModal(false)} />}
    </div>
  );
}

const secondaryButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

const outlineButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

const editLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
