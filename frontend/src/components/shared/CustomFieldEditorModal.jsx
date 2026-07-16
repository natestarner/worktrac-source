import { useState } from 'react';
import { updateCustomField } from '../../api/exercises';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

// Sets the per-person value of a custom setup field (adding/renaming/removing fields lives in
// the Configure modal). The value is stored on the overlay row, so this never touches the
// exercise's shared base fields.
export default function CustomFieldEditorModal({ personId, exerciseId, field, onClose, onSaved }) {
  const [value, setValue] = useState(field.value || '');

  async function handleSave() {
    await updateCustomField(personId, exerciseId, field.id, { value: value.trim() });
    onSaved();
  }

  return (
    <Modal width={300} onScrim={onClose}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {field.name}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>Just for this person</div>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
        <Button
          onClick={handleSave}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
