import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPastSession } from '../../api/sessions';
import { queryKeys } from '../../api/queryKeys';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useRequireOnline } from '../../hooks/useRequireOnline';
import { localDateTimeToIso, toLocalDateStr, toLocalTimeStr } from '../../utils/datetime';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function PastSessionModal({ onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activePersonId, startEditingSession } = useAppState();
  const { people } = useAuth();
  const { online, requireOnline } = useRequireOnline();
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  const now = new Date().toISOString();
  const [date, setDate] = useState(toLocalDateStr(now));
  const [time, setTime] = useState(toLocalTimeStr(now));

  // Online-only (Tier 3): createPastSession has no idempotency key, so a queued offline replay would
  // duplicate the session -- gate it rather than let it queue. Retroactive entry is a sit-at-home
  // action anyway, never done mid-workout with no signal.
  const handleStart = requireOnline(async () => {
    const iso = localDateTimeToIso(date, time);
    const session = await createPastSession(activePersonId, iso);
    // The new (empty) session belongs in this person's History immediately.
    queryClient.invalidateQueries({ queryKey: queryKeys.history(activePersonId) });
    startEditingSession(session);
    onClose();
    navigate('/app/log');
  }, 'You need a connection to log a past workout.');

  return (
    <Modal width={340} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Log a past workout</div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 18 }}>When did {activePersonName} work out?</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          // 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 16 }}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 16 }}
        />
      </div>
      {!online && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
          Logging a past workout needs a connection.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleStart}
          disabled={!online}
          style={{
            flex: 1,
            padding: 14,
            background: online ? 'var(--color-accent)' : 'var(--color-faint)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: online ? 'pointer' : 'not-allowed',
          }}
        >
          Start adding sets
        </Button>
      </div>
    </Modal>
  );
}
