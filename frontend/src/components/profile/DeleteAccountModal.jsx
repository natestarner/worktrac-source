import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { accountVocab } from '../../utils/accountVocab';
import { deleteAccount } from '../../api/account';
import { downloadAllPeopleZip } from '../../api/export';
import Modal from '../shared/Modal';
import Button from '../shared/Button';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import { cancelButtonStyle, deleteButtonStyle } from '../shared/ConfirmDialog';
import ProviderButtons from '../auth/ProviderButtons';
import { useSignInMethods } from '../../hooks/useSignInMethods';

const CONFIRMATION_WORD = 'DELETE';

export default function DeleteAccountModal({ onClose }) {
  const { account, people, logout } = useAuth();
  const vocab = accountVocab(account?.vocab);

  // ⚠️ On a family account this sentence destroys YOUR OWN data. On a trainer's it destroys OTHER
  // PEOPLE'S -- clients who never agreed to it and cannot get it back. Naming the number is what
  // turns "everyone on this account" from a phrase into a fact somebody has to read past.
  //
  // Everybody but the person deleting, since their own record is not the surprising part. Counted
  // from the visible people rather than asked for: the modal already has the list, and an extra
  // request on a destructive confirm is one more thing that can fail at the worst moment.
  const othersCount = Math.max(people.length - 1, 0);
  const otherPeople = othersCount === 1
    ? `1 other ${vocab.member}`
    : `${othersCount} other ${vocab.member}s`;
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // How this login proves it's them. A password, as always -- or, for a login with no password,
  // signing in again with a connected Apple / Google account. A login with APPLE connected must
  // confirm with Apple even if it has a password: deleting has to disconnect Huddle from the Apple
  // ID, and only Apple's sheet hands over the one-time code that needs (App Store requirement).
  //
  // Unknown (not loaded) reads as today's password form; the server's NO_PASSWORD or
  // APPLE_RECONFIRMATION_REQUIRED answer then switches it (`serverAsked`).
  const { data: methods } = useSignInMethods();
  const [serverAsked, setServerAsked] = useState(null);
  const connected = (methods?.connected ?? []).map((c) => c.provider);
  const appleConnected = connected.includes('apple') || serverAsked === 'APPLE_RECONFIRMATION_REQUIRED';
  const noPassword = methods?.hasPassword === false || serverAsked === 'NO_PASSWORD';
  const confirmWith = appleConnected ? ['apple'] : noPassword ? connected : null;

  async function submit(reconfirmation) {
    setError('');
    try {
      // The password path sends exactly what it always did.
      if (reconfirmation) await deleteAccount(CONFIRMATION_WORD, undefined, reconfirmation);
      else await deleteAccount(CONFIRMATION_WORD, password);
      logout();
      navigate('/login');
    } catch (err) {
      if (err?.code === 'NO_PASSWORD' || err?.code === 'APPLE_RECONFIRMATION_REQUIRED') {
        setServerAsked(err.code);
      }
      setError(err.message || 'Could not delete your account');
    }
  }

  const handleDelete = () => submit(null);

  function handleProviderToken(provider, token) {
    return submit({
      provider,
      idToken: token.idToken,
      nonce: token.nonce,
      appleAuthorizationCode: token.appleAuthorizationCode,
      appleRedirectUri: token.appleRedirectUri,
    });
  }

  return (
    <Modal width={380} onClose={onClose} title="Delete your account?">
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 16 }}>
        This permanently deletes all data for everyone on this account -- every exercise, set, session, routine, and
        setup value. This cannot be undone, and this email will look brand new if you ever register again.
        {othersCount > 0 && (
          <>
            {' '}
            <strong>
              That includes {otherPeople}, and they cannot get it back.
            </strong>{' '}
            Download their history below first if they might want it.
          </>
        )}
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
          <OfflineDisabledWrap message="Exporting needs a connection.">
            <button onClick={() => downloadAllPeopleZip()} style={downloadLinkStyle}>
              Download all
            </button>
          </OfflineDisabledWrap>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--color-highlight-bg)',
            color: 'var(--color-danger)',
            borderRadius: 'var(--radius-md)',
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
          borderRadius: 'var(--radius-md)',
          fontSize: 16,
          marginBottom: 16,
        }}
      />

      {confirmWith ? (
        <>
          {/* No password to type (or Apple must be asked): confirming with the provider is the
              proof, and it is the delete. Not offered until DELETE is typed. */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {appleConnected
              ? // Apple's sheet asks whether to "continue using Huddle" with the Apple ID -- its own
                // wording, which we can't change, and which reads backwards mid-delete. Say so first.
                'Apple will ask whether to continue using Huddle with your Apple ID. Choose Continue: that only confirms it’s you. Huddle then deletes your account and disconnects itself from your Apple ID.'
              : 'Confirm it’s you'}
          </div>
          <div style={{ marginBottom: 16 }}>
            <ProviderButtons
              only={confirmWith}
              verb="Delete and confirm with"
              disabled={confirmText !== CONFIRMATION_WORD}
              onToken={handleProviderToken}
              onError={() => setError("Couldn't reach the sign-in service. Try again.")}
            />
          </div>
          <button onClick={onClose} style={{ ...cancelButtonStyle, width: '100%' }}>
            Cancel
          </button>
        </>
      ) : (
      <>
      {/* Typing DELETE proves intent; the password proves identity. The token that got them this
          far is valid for 30 days with no revocation, which is a weak thing to hang an
          irreversible, unrecoverable action on -- a family tablet left signed in is enough. */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Enter your password</div>
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Your password"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 16,
          marginBottom: 16,
        }}
      />

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleDelete}
          disabled={confirmText !== CONFIRMATION_WORD || !password}
          style={deleteButtonStyle}
        >
          Delete account
        </Button>
      </div>
      </>
      )}
    </Modal>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '4px 14px',
  marginBottom: 16,
};

const downloadLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
