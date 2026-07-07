import { useState } from 'react';
import { setSetupValue } from '../../api/setupValues';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';

export default function SetupFieldEditorModal({ personId, exerciseId, field, onClose, onSaved }) {
  const [draft, setDraft] = useState(field.value || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await setSetupValue(personId, exerciseId, field.fieldId, draft.trim());
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal width={300} onScrim={onClose}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {field.fieldName}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>Just for this person</div>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. 5"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          fontSize: 18,
          fontWeight: 700,
          marginBottom: 18,
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
