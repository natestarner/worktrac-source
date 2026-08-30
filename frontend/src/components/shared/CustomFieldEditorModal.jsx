import { useState } from 'react';
import { updateCustomField } from '../../api/exercises';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import Modal from './Modal';
import OfflineNotice from './OfflineNotice';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';
import { FIELD_LIMITS } from '../../utils/fieldLimits';

// Sets the per-person value of a custom setup field (adding/renaming/removing fields lives in
// the Configure modal). The value is stored on the overlay row, so this never touches the
// exercise's shared base fields.
export default function CustomFieldEditorModal({ personId, exerciseId, field, onClose, onSaved }) {
  const [value, setValue] = useState(field.value || '');
  const { online, run } = useGatedMutation();

  async function handleSave() {
    await updateCustomField(personId, exerciseId, field.id, { value: value.trim() });
    onSaved();
  }

  const guardedSave = run(handleSave, { offlineMessage: 'Editing needs a connection.' });

  return (
    <Modal width={300} onClose={onClose}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {field.name}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>Just for this person</div>
      <OfflineNotice message="Editing needs a connection -- the current value is still shown above." />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!online}
        placeholder="e.g. 5"
        maxLength={FIELD_LIMITS.customFieldValue}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          fontSize: 18,
          fontWeight: 700,
          marginBottom: 18,
          opacity: online ? 1 : 0.6,
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={guardedSave}
          disabled={!online}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: online ? 'pointer' : 'not-allowed' }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
