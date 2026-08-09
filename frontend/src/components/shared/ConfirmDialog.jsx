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
    <Modal width={320} labelledBy="confirm-dialog-message">
      <div id="confirm-dialog-message" style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
        {confirmDialog.message}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {/* Not disabled while pending: a delete tapped offline can sit paused for a long
            time (see logSetMutation's analogous offline-pause handling in ExerciseDetail.jsx),
            and the user must always be able to back out of the dialog, even mid-request. */}
        <button onClick={closeConfirm} className="pressable" style={cancelButtonStyle}>
          Cancel
        </button>
        <button onClick={handleDelete} disabled={pending} className="pressable" style={{ ...deleteButtonStyle, position: 'relative' }}>
          <span style={{ visibility: pending ? 'hidden' : 'visible' }}>Delete</span>
          {pending && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="currentColor" />
            </span>
          )}
        </button>
      </div>
    </Modal>
  );
}

// Thirteen other modals import these as their own footer button pair, so they stay style
// objects rather than becoming .btn classes -- migrating all 13 call sites is a separate
// change. Values are tokenised, and the min-height brings them to the 44px touch target.
export const cancelButtonStyle = {
  flex: 1,
  minHeight: 44,
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};

export const deleteButtonStyle = {
  flex: 1,
  minHeight: 44,
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--color-danger)',
  color: 'var(--color-accent-contrast)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};
