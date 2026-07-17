import { useState } from 'react';
import { addCustomField, updateCustomField, removeCustomField, setExerciseCategory, updateExercise } from '../../api/exercises';
import { createPersonCategory } from '../../api/personCategories';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';

// One place to personalize an exercise: rename/delete (your own exercises only), which of the
// person's categories it's filed under, and the custom setup fields they've added. Setting a
// field's *value* still happens by tapping its pill on the exercise screen -- this modal is
// about structure, not values. Preloaded exercises are shared and immutable, so they show a
// "Preloaded exercise" badge and no rename/delete.
export default function ConfigureExerciseModal({
  exercise,
  personId,
  exerciseId,
  currentCategoryId,
  categories,
  customFields,
  onClose,
  onFieldsChanged,
  onCategoryChanged,
  onExerciseChanged,
  onRequestDelete,
}) {
  const isOwn = exercise && !exercise.isGlobal;
  const [name, setName] = useState(exercise?.name || '');
  const [newFieldName, setNewFieldName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === exercise.name || busy) return;
    setBusy(true);
    try {
      await updateExercise(exercise.id, { name: trimmed });
      if (onExerciseChanged) await onExerciseChanged();
    } finally {
      setBusy(false);
    }
  }

  async function fileCategory(categoryId) {
    setBusy(true);
    try {
      await setExerciseCategory(personId, exerciseId, categoryId);
      await onCategoryChanged();
    } finally {
      setBusy(false);
    }
  }

  async function createAndFileCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await createPersonCategory(personId, trimmed);
      await setExerciseCategory(personId, exerciseId, created.id);
      setNewCategoryName('');
      await onCategoryChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addField() {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    await addCustomField(personId, exerciseId, trimmed);
    setNewFieldName('');
    await onFieldsChanged();
  }

  async function renameField(field, fieldName) {
    const trimmed = fieldName.trim();
    if (!trimmed || trimmed === field.name) return;
    await updateCustomField(personId, exerciseId, field.id, { name: trimmed });
    await onFieldsChanged();
  }

  async function removeField(field) {
    await removeCustomField(personId, exerciseId, field.id);
    await onFieldsChanged();
  }

  const options = [{ id: null, name: 'Uncategorized' }, ...categories];

  return (
    <Modal width={360} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Customize this exercise</div>
      <div style={{ marginBottom: 18 }}>
        <span style={isOwn ? ownBadgeStyle : preloadedBadgeStyle}>{isOwn ? 'Created by you' : 'Preloaded exercise'}</span>
      </div>

      {isOwn && (
        <>
          <div style={labelStyle}>Name</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveName();
                }
              }}
              onBlur={saveName}
              style={inputStyle}
            />
            <button onClick={saveName} disabled={busy || !name.trim() || name.trim() === exercise.name} style={smallButtonStyle}>
              Save
            </button>
          </div>
        </>
      )}

      <div style={labelStyle}>Category</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {options.map((c) => {
          const active = (c.id ?? null) === (currentCategoryId ?? null);
          return (
            <button
              key={c.id ?? 'none'}
              onClick={() => fileCategory(c.id)}
              disabled={busy}
              style={{
                padding: '8px 14px',
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              createAndFileCategory();
            }
          }}
          placeholder="New category"
          style={inputStyle}
        />
        <button onClick={createAndFileCategory} disabled={busy || !newCategoryName.trim()} style={smallButtonStyle}>
          Create
        </button>
      </div>

      <div style={labelStyle}>Setup fields</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {customFields.map((field) => (
          <div key={field.id} style={{ display: 'flex', gap: 8 }}>
            <input
              defaultValue={field.name}
              onBlur={(e) => renameField(field, e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => removeField(field)}
              aria-label={`Remove ${field.name}`}
              style={{ ...smallButtonStyle, background: 'var(--color-subtle-bg)', color: 'var(--color-danger)' }}
            >
              &times;
            </button>
          </div>
        ))}
        {customFields.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-faint)' }}>No custom fields yet.</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addField();
            }
          }}
          placeholder="Add a field (e.g. seat height)"
          style={inputStyle}
        />
        <button onClick={addField} disabled={!newFieldName.trim()} style={smallButtonStyle}>
          Add
        </button>
      </div>

      {isOwn && (
        <button onClick={onRequestDelete} style={{ ...cancelButtonStyle, width: '100%', color: 'var(--color-danger)', marginBottom: 10 }}>
          Delete this exercise
        </button>
      )}

      <button onClick={onClose} style={{ ...cancelButtonStyle, width: '100%' }}>
        Done
      </button>
    </Modal>
  );
}

const labelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};

const inputStyle = {
  flex: 1,
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 14,
};

const smallButtonStyle = {
  padding: '10px 16px',
  background: 'var(--color-dark)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const ownBadgeStyle = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  background: 'var(--color-pr-bg)',
  color: 'var(--color-pr-text)',
  border: '1px solid var(--color-pr-border)',
  fontSize: 12,
  fontWeight: 700,
};

const preloadedBadgeStyle = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-muted)',
  fontSize: 12,
  fontWeight: 700,
};
