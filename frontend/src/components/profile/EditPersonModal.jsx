import { useState } from 'react';
import { updatePerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';
import { FIELD_LIMITS } from '../../utils/fieldLimits';

export default function EditPersonModal({ person, onClose }) {
  const { refreshPeople } = useAuth();
  const [name, setName] = useState(person.name);
  const [nameError, setNameError] = useState(false);
  const { run } = useGatedMutation();

  const handleSave = run(
    async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError(true);
        return;
      }
      await updatePerson(person.id, trimmed);
      await refreshPeople();
      onClose();
    },
    {
      offlineMessage: 'Renaming a person needs a connection.',
      errorMessage: "Couldn't save that name.",
    },
  );

  return (
    <Modal width={320} onClose={onClose} title={`Edit ${person.name}`}>
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Name"
        maxLength={FIELD_LIMITS.personName}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: `1px solid ${nameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
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
            borderRadius: 'var(--radius-md)',
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
