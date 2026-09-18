import { useState } from 'react';
import { addPerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useAppState } from '../../context/AppStateContext';
import { queryClient } from '../../lib/queryClient';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';
import { FIELD_LIMITS } from '../../utils/fieldLimits';

export default function AddPersonModal({ onClose }) {
  const { refreshPeople } = useAuth();
  const { selectPerson } = useAppState();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const { run } = useGatedMutation();

  // Tier-3: adding a person is not idempotent, so it is gated rather than queued -- a replay would
  // create duplicate people. Previously it had neither the gate nor an error path.
  const handleAdd = run(
    async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError(true);
        return;
      }
      const person = await addPerson(trimmed);
      await refreshPeople();
      // ⚠️ THE ROSTER DERIVES FROM PEOPLE TOO, and it is account-shared rather than person-keyed --
      // same reasoning as the set-logging invalidation in queryClient.js (see its comment), except
      // this gap was in the OTHER direction: offlineCacheWarm had already cached the roster from
      // before this person existed, so a trainer who added a client and immediately checked their
      // roster saw it as though the client were not there -- for up to a minute, with nothing on
      // screen looking wrong. Prefix, because the key carries a weeks window this caller cannot know.
      queryClient.invalidateQueries({ queryKey: ['roster'] });
      selectPerson(person.id);
      onClose();
    },
    {
      offlineMessage: 'Adding a person needs a connection.',
      errorMessage: "Couldn't add that person.",
    },
  );

  return (
    <Modal width={320} onClose={onClose} title="Add a person">
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
          onClick={handleAdd}
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
          Add
        </Button>
      </div>
    </Modal>
  );
}
