import { useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import Input from '../shared/Input';
import Modal from '../shared/Modal';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';

/**
 * "Change your password", for whoever is signed in.
 *
 * <p>Shown to every role, and that is the point rather than an oversight. Before member logins the
 * app had no such screen at all — changing a password meant using forgot-password like a stranger.
 * That was tolerable when a household had one login; it is not once a teenager has their own,
 * because the alternative routes them through an email a parent may well be able to read.
 *
 * ⚠️ There is deliberately no owner-side counterpart anywhere in the app. An owner may invite,
 * revoke and unlock — never set somebody's password — because an owner who can set a member's
 * password can impersonate them. The transparency line directly above this section promises
 * exactly that; if a control to set another person's password is ever added, that sentence has to
 * change in the same commit.
 */
export default function ChangePasswordSection() {
  const { changeOwnPassword } = useAuth();
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SectionLabel>Password</SectionLabel>
      <div style={cardStyle}>
        <div style={rowStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={labelStyle}>Your password</div>
            <div style={hintStyle}>
              Changing it signs you out everywhere else.
            </div>
          </div>
          {/* Online-only: this mints a session token, so there is nothing to queue and nothing
              cached behind it -- the same reason switching household is Tier-3. */}
          <OfflineDisabledWrap message="Changing your password needs a connection.">
            <button onClick={() => setOpen(true)} style={linkStyle}>
              Change
            </button>
          </OfflineDisabledWrap>
        </div>
      </div>

      {open && (
        <ChangePasswordModal
          onClose={() => setOpen(false)}
          onChanged={() => {
            setOpen(false);
            showToast('Password changed.');
          }}
          changeOwnPassword={changeOwnPassword}
        />
      )}
    </>
  );
}

function ChangePasswordModal({ onClose, onChanged, changeOwnPassword }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState(null);

  const { online, pending, run } = useGatedMutation();

  const submit = run(
    async () => {
      await changeOwnPassword({ currentPassword, newPassword });
      onChanged();
    },
    {
      offlineMessage: 'Changing your password needs a connection.',
      errorMessage: "Couldn't change your password.",
      // The refusals here are ones only the person can act on -- "that isn't your current
      // password", and the lockout after too many tries. Replacing either with a generic message
      // would send somebody looking for a connection problem that does not exist.
      showServerMessage: true,
    },
  );

  // Checked here rather than server-side because it is not a rule about the credential -- the
  // server has no second field to compare against, and shouldn't: sending a typo'd password twice
  // is a typing mistake, not an invalid request.
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) {
      setLocalError('Fill in all three fields, with a new password of at least 8 characters.');
      return;
    }
    setLocalError(null);
    submit();
  }

  return (
    <Modal title="Change your password" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <label htmlFor="current-password" style={fieldLabelStyle}>Current password</label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />

        <label htmlFor="new-password" style={{ ...fieldLabelStyle, marginTop: 'var(--space-4)' }}>
          New password
        </label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={tooShort ? 'Use at least 8 characters.' : undefined}
        />

        <label htmlFor="confirm-password" style={{ ...fieldLabelStyle, marginTop: 'var(--space-4)' }}>
          Confirm new password
        </label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={mismatch ? "Those don't match." : undefined}
        />

        {/* Said before they commit, not after: this is the part people are surprised by, and the
            surprise costs them a re-login on every other device they own. */}
        <p style={noticeStyle}>
          You&rsquo;ll stay signed in here. Every other device signed in as you will be signed out.
        </p>

        {localError && <div style={errorStyle}>{localError}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="submit" disabled={!online || pending} style={primaryButtonStyle}>
            {pending ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  marginBottom: 'var(--space-6)',
};

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-4)',
};

const labelStyle = { fontSize: 15, fontWeight: 600 };

const hintStyle = { fontSize: 13, color: 'var(--color-muted)', marginTop: 2 };

const linkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-accent-text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

// Matches ImportDataModal's and LoginsSection's field label -- not the uppercase section-label
// idiom, which belongs to <SectionLabel> and marks a heading above a group of content.
const fieldLabelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
};

const noticeStyle = {
  margin: '18px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--color-muted)',
};

const errorStyle = {
  marginTop: 12,
  fontSize: 14,
  color: 'var(--color-danger)',
};

const primaryButtonStyle = {
  flex: 1,
  padding: '12px 16px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryButtonStyle = {
  flex: 1,
  padding: '12px 16px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};
