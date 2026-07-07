import { useUI } from '../../context/UIContext';
import Modal from './Modal';

export default function ConfirmDialog() {
  const { confirmDialog, closeConfirm, runConfirm } = useUI();
  if (!confirmDialog) return null;

  return (
    <Modal width={320}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 22 }}>{confirmDialog.message}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={closeConfirm} style={cancelButtonStyle}>
          Cancel
        </button>
        <button onClick={runConfirm} style={deleteButtonStyle}>
          Delete
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
