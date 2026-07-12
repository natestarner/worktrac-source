import { useState } from 'react';
import { copyRoutine } from '../../api/routines';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function CopyRoutineModal({ routine, personId, onClose }) {
  const { people } = useAuth();
  const { showToast } = useUI();
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState(false);

  const otherPeople = people.filter((p) => p.id !== personId);

  function toggle(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setError(false);
  }

  async function handleCopy() {
    if (selectedIds.length === 0) {
      setError(true);
      return;
    }
    await copyRoutine(personId, routine.id, selectedIds);
    const names = otherPeople.filter((p) => selectedIds.includes(p.id)).map((p) => p.name);
    showToast(`Copied "${routine.name}" to ${names.join(', ')}`);
    onClose();
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Copy &quot;{routine.name}&quot; to&hellip;</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: error ? 6 : 16 }}>
        {otherPeople.map((p) => (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
      </div>
      {error && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 16 }}>
          Select at least one person.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleCopy}
          style={{
            flex: 1,
            padding: 14,
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Copy
        </Button>
      </div>
    </Modal>
  );
}
