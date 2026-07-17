import { useState } from 'react';
import { addCustomField, updateCustomField, removeCustomField, setExerciseTags, updateExercise } from '../../api/exercises';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';

// One place to personalize an exercise: rename/delete (your own exercises only), which of the
// account's tags are applied to it (for this person), and the custom setup fields they've added.
// Setting a field's *value* still happens by tapping its pill on the exercise screen -- this
// modal is about structure, not values. Preloaded exercises are shared and immutable, so they
// show a "Preloaded exercise" badge and no rename/delete.
export default function ConfigureExerciseModal({
  exercise,
  personId,
  exerciseId,
  allTags = [],
  appliedTagNames = [],
  customFields,
  onClose,
  onFieldsChanged,
  onTagsChanged,
  onExerciseChanged,
  onRequestDelete,
}) {
  const isOwn = exercise && !exercise.isGlobal;
  const [name, setName] = useState(exercise?.name || '');
  const [newFieldName, setNewFieldName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === exercise.name || busy) return;
    setBusy(true);
    try {
      // Pass the current base field names so a pure rename doesn't clear them.
      await updateExercise(exercise.id, { name: trimmed, setupFieldNames: (exercise.setupFields || []).map((f) => f.name) });
      if (onExerciseChanged) await onExerciseChanged();
    } finally {
      setBusy(false);
    }
  }

  // The exercise's currently-applied tag names, compared case-insensitively so a chip's selected
  // state matches regardless of how the vocabulary happens to be cased.
  const selectedLower = new Set(appliedTagNames.map((n) => n.toLowerCase()));
  const isSelected = (tagName) => selectedLower.has(tagName.toLowerCase());

  // Apply the full new set of selected tag names, then let the parent refetch the exercise.
  // createdNew flags that a brand-new name was introduced, so the account tag list gets refetched
  // too (so it shows up as a chip).
  async function applyTags(selectedNames, createdNew = false) {
    setBusy(true);
    try {
      await setExerciseTags(personId, exerciseId, selectedNames);
      await onTagsChanged(createdNew);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTag(tagName) {
    if (busy) return;
    const next = isSelected(tagName)
      ? appliedTagNames.filter((n) => n.toLowerCase() !== tagName.toLowerCase())
      : [...appliedTagNames, tagName];
    await applyTags(next);
  }

  async function addTag() {
    const trimmed = newTagName.trim();
    if (!trimmed || busy) return;
    setNewTagName('');
    if (isSelected(trimmed)) return; // already applied -- nothing to do
    await applyTags([...appliedTagNames, trimmed], true);
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

      <div style={labelStyle}>Tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {allTags.map((t) => {
          const active = isSelected(t.name);
          return (
            <button
              key={t.id}
              onClick={() => toggleTag(t.name)}
              disabled={busy}
              aria-pressed={active}
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
              {t.name}
            </button>
          );
        })}
        {allTags.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-faint)' }}>No tags yet.</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="New tag"
          style={inputStyle}
        />
        <button onClick={addTag} disabled={busy || !newTagName.trim()} style={smallButtonStyle}>
          Add
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
