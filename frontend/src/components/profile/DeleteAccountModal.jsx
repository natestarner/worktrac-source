import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { deleteAccount } from '../../api/account';
import { downloadAllPeopleZip } from '../../api/export';
import Modal from '../shared/Modal';
import Button from '../shared/Button';
import { cancelButtonStyle, deleteButtonStyle } from '../shared/ConfirmDialog';

const CONFIRMATION_WORD = 'DELETE';

export default function DeleteAccountModal({ onClose }) {
  const { people, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  async function handleDelete() {
    setError('');
    try {
      await deleteAccount(CONFIRMATION_WORD);
      logout();
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Could not delete your account');
    }
  }

  return (
    <Modal width={380} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Delete your account?</div>
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 16 }}>
        This permanently deletes all data for everyone on this account -- every exercise, set, session, routine, and
        setup value. This cannot be undone, and this email will look brand new if you ever register again.
      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 0',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Download your data first</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              A zip with every person&apos;s workout history ({people.map((p) => p.name).join(', ')})
            </div>
          </div>
          <button onClick={() => downloadAllPeopleZip()} style={downloadLinkStyle}>
            Download all
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--color-pr-bg)',
            color: 'var(--color-danger)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Type <strong>{CONFIRMATION_WORD}</strong> to confirm
      </div>
      <input
        autoFocus
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRMATION_WORD}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          fontSize: 16,
          marginBottom: 16,
        }}
      />

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button onClick={handleDelete} disabled={confirmText !== CONFIRMATION_WORD} style={deleteButtonStyle}>
          Delete account
        </Button>
      </div>
    </Modal>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: '4px 14px',
  marginBottom: 16,
};

const downloadLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
