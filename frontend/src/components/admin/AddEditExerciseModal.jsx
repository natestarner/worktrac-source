import { useEffect, useState } from 'react';
import { addExercise, updateExercise } from '../../api/exercises';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function AddEditExerciseModal({ exercise, categories, onClose, onSaved }) {
  const isEditing = !!exercise;
  const [name, setName] = useState(exercise?.name || '');
  const [categoryId, setCategoryId] = useState(exercise?.categoryId ?? categories[0]?.id);
  const [setupFieldNames, setSetupFieldNames] = useState(exercise?.setupFields.map((f) => f.name) || []);
  const [newFieldInput, setNewFieldInput] = useState('');
  const [nameError, setNameError] = useState(false);

  // categories can still be loading when this modal first mounts (nothing in AdminTab
  // gates "+ Add exercise" behind categories being ready), which would otherwise leave
  // categoryId stuck at undefined forever and make Save a silent no-op. Backfill the
  // default once categories arrive, but only if nothing's been selected yet.
  useEffect(() => {
    if (categoryId === undefined && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  function addField() {
    const trimmed = newFieldInput.trim();
    if (!trimmed || setupFieldNames.includes(trimmed)) {
      setNewFieldInput('');
      return;
    }
    setSetupFieldNames((fields) => [...fields, trimmed]);
    setNewFieldInput('');
  }
  function removeField(name) {
    setSetupFieldNames((fields) => fields.filter((f) => f !== name));
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    if (!categoryId) return;
    const payload = { name: trimmed, categoryId, setupFieldNames };
    if (isEditing) {
      await updateExercise(exercise.id, payload);
    } else {
      await addExercise(payload);
    }
    onSaved();
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
          marginBottom: nameError ? 6 : 12,
        }}
      />
      {nameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 12 }}>Enter an exercise name.</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {categories.map((c) => {
          const active = c.id === categoryId;
          return (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              style={{
                padding: '9px 14px',
                borderRadius: 999,
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                color: active ? '#fff' : 'var(--color-text)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      {isEditing && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 18 }}>
          {exercise.isGlobal
            ? 'This is a shared system exercise -- saving creates your own private copy with these changes. Other households keep seeing the original untouched, and your own logged sets/history/PRs for it move over to your copy automatically.'
            : 'Renaming or re-categorizing keeps all logged sets, history, and PRs for this exercise intact.'}
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
          disabled={!categoryId}
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
