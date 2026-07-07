import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPastSession } from '../../api/sessions';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { localDateTimeToIso, toLocalDateStr, toLocalTimeStr } from '../../utils/datetime';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';

export default function PastSessionModal({ onClose }) {
  const navigate = useNavigate();
  const { activePersonId, startEditingSession } = useAppState();
  const { people } = useAuth();
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  const now = new Date().toISOString();
  const [date, setDate] = useState(toLocalDateStr(now));
  const [time, setTime] = useState(toLocalTimeStr(now));
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setSubmitting(true);
    try {
      const iso = localDateTimeToIso(date, time);
      const session = await createPastSession(activePersonId, iso);
      startEditingSession(session);
      onClose();
      navigate('/app/log');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal width={340} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Log a past workout</div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 18 }}>When did {activePersonName} work out?</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 15 }}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 15 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <button
          onClick={handleStart}
          disabled={submitting}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Start adding sets
        </button>
      </div>
    </Modal>
  );
}
