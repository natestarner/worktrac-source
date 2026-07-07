import { useState } from 'react';
import { addPerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';

export default function AddPersonModal({ onClose }) {
  const { refreshPeople } = useAuth();
  const { selectPerson } = useAppState();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const person = await addPerson(trimmed);
      await refreshPeople();
      selectPerson(person.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Add a person</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          fontSize: 16,
          marginBottom: 16,
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={submitting}
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
          Add
        </button>
      </div>
    </Modal>
  );
}
