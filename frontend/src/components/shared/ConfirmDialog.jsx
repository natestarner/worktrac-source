import { useState } from 'react';
import { useUI } from '../../context/UIContext';
import Modal from './Modal';
import Spinner from './Spinner';

export default function ConfirmDialog() {
  const { confirmDialog, closeConfirm, runConfirm } = useUI();
  const [pending, setPending] = useState(false);
  if (!confirmDialog) return null;

  async function handleDelete() {
    setPending(true);
    try {
      await runConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal width={320}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 22 }}>{confirmDialog.message}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={closeConfirm} disabled={pending} style={cancelButtonStyle}>
          Cancel
        </button>
        <button onClick={handleDelete} disabled={pending} style={{ ...deleteButtonStyle, position: 'relative' }}>
          <span style={{ visibility: pending ? 'hidden' : 'visible' }}>Delete</span>
          {pending && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="#fff" />
            </span>
          )}
        </button>
      </div>
    </Modal>
  );
}

export const cancelButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};

export const deleteButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-danger)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
};
