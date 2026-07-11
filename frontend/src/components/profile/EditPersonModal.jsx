import { useState } from 'react';
import { updatePerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function EditPersonModal({ person, onClose }) {
  const { refreshPeople } = useAuth();
  const [name, setName] = useState(person.name);
  const [nameError, setNameError] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    await updatePerson(person.id, trimmed);
    await refreshPeople();
    onClose();
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Edit {person.name}</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Name"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: `1px solid ${nameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 10,
          fontSize: 16,
          marginBottom: nameError ? 6 : 16,
        }}
      />
      {nameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 16 }}>Enter a name.</div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
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
          Save
        </Button>
      </div>
    </Modal>
  );
}
