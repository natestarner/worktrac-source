import { useState } from 'react';
import { addExercise, updateExercise, favoriteExercise } from '../../api/exercises';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

// Add-your-own / edit-your-own exercise. Categories are per-person now, so there's no category
// selector here -- a new exercise is created uncategorized and auto-favorited for the active
// person (file it into a category later from the picker). Editing is only reachable for the
// account's own exercises; preloaded ones are favorite-as-is.
export default function AddEditExerciseModal({ exercise, personId, initialName = '', onClose, onSaved }) {
  const isEditing = !!exercise;
  const [name, setName] = useState(exercise?.name || initialName || '');
  const [setupFieldNames, setSetupFieldNames] = useState(exercise?.setupFields?.map((f) => f.name) || []);
  const [newFieldInput, setNewFieldInput] = useState('');
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);

  function addField() {
    const trimmed = newFieldInput.trim();
    if (!trimmed || setupFieldNames.includes(trimmed)) {
      setNewFieldInput('');
      return;
    }
    setSetupFieldNames((fields) => [...fields, trimmed]);
    setNewFieldInput('');
  }
  function removeField(fieldName) {
    setSetupFieldNames((fields) => fields.filter((f) => f !== fieldName));
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        const updated = await updateExercise(exercise.id, { name: trimmed, setupFieldNames });
        onSaved(updated);
      } else {
        const created = await addExercise({ name: trimmed, setupFieldNames });
        // Auto-favorite so it lands in this person's picker immediately.
        if (personId) await favoriteExercise(personId, created.id);
        onSaved(created);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal width={340} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{isEditing ? 'Edit exercise' : 'Add exercise'}</div>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Exercise name"
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
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 12 }}>Enter an exercise name.</div>
      )}

      {isEditing && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 18 }}>
          Renaming keeps all logged sets, history, and PRs for this exercise intact.
        </div>
      )}

      <div style={sectionLabelStyle}>Setup fields (e.g. seat height, spotter pin)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {setupFieldNames.map((f) => (
          <div
            key={f}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 6px 6px 12px',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {f}
            <button onClick={() => removeField(f)} style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 14, cursor: 'pointer' }}>
              &times;
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={newFieldInput}
          onChange={(e) => setNewFieldInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addField();
            }
          }}
          placeholder="Field name"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 14 }}
        />
        <button onClick={addField} style={{ padding: '10px 16px', background: 'var(--color-subtle-bg)', color: 'var(--color-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Add
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          {isEditing ? 'Save' : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};
