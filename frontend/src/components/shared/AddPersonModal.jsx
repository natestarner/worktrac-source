import { useState } from 'react';
import { addPerson } from '../../api/people';
import { addAndInviteLogin } from '../../api/logins';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useAppState } from '../../context/AppStateContext';
import { queryClient } from '../../lib/queryClient';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';
import { FIELD_LIMITS } from '../../utils/fieldLimits';

/**
 * Add a person -- and, from Profile, optionally hand them a login in the same motion.
 *
 * `offerLogin` is passed only by Profile's People list, and only when the plan includes member
 * logins: it adds an optional Email field. Left empty, this is exactly the plain add the person bar
 * has always done. Filled in, the name and address go to `addAndInviteLogin` as ONE request -- see
 * that function's header for why two calls would leave an orphan person behind on every refused
 * invitation. The person bar never passes it: it is a quick switcher, not where logins are managed.
 */
export default function AddPersonModal({ onClose, offerLogin = false, onAdded }) {
  const { refreshPeople } = useAuth();
  const { selectPerson } = useAppState();
  const { showToast } = useUI();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [nameError, setNameError] = useState(false);
  const { run } = useGatedMutation();
  const inviting = offerLogin && email.trim() !== '';

  // ⚠️ THE ROSTER DERIVES FROM PEOPLE TOO, and it is account-shared rather than person-keyed --
  // same reasoning as the set-logging invalidation in queryClient.js (see its comment), except
  // this gap was in the OTHER direction: offlineCacheWarm had already cached the roster from
  // before this person existed, so a trainer who added a client and immediately checked their
  // roster saw it as though the client were not there -- for up to a minute, with nothing on
  // screen looking wrong. Prefix, because the key carries a weeks window this caller cannot know.
  async function afterAdd() {
    await refreshPeople();
    queryClient.invalidateQueries({ queryKey: ['roster'] });
    await onAdded?.();
  }

  // Tier-3: adding a person is not idempotent, so it is gated rather than queued -- a replay would
  // create duplicate people. Previously it had neither the gate nor an error path.
  const addPlain = run(
    async (trimmed) => {
      const person = await addPerson(trimmed);
      await afterAdd();
      selectPerson(person.id);
      onClose();
    },
    {
      offlineMessage: 'Adding a person needs a connection.',
      errorMessage: "Couldn't add that person.",
    },
  );

  // Not followed by selectPerson: the owner is setting somebody else up to sign in on their own
  // device, and is still on Profile managing logins -- switching the whole app to that person would
  // be a surprise with no reason behind it.
  const addWithLogin = run(
    async (trimmed, address) => {
      await addAndInviteLogin(trimmed, address);
      await afterAdd();
      showToast('Invite sent.');
      onClose();
    },
    {
      offlineMessage: 'Sending an invite needs a connection.',
      errorMessage: "Couldn't add that person.",
      // The refusals are written for a person: that address is already on this account, or the
      // plan does not include member logins.
      showServerMessage: true,
    },
  );

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return undefined;
    }
    // Trimmed -- a trailing space pasted from a contacts app must not become part of the address.
    return inviting ? addWithLogin(trimmed, email.trim()) : addPlain(trimmed);
  }

  return (
    <Modal width={offerLogin ? 380 : 320} onClose={onClose} title="Add a person">
      {offerLogin && (
        <label htmlFor="add-person-name" style={labelStyle}>Name</label>
      )}
      <input
        id="add-person-name"
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Name"
        maxLength={FIELD_LIMITS.personName}
        style={{ ...inputStyle, borderColor: nameError ? 'var(--color-danger)' : 'var(--color-border)', marginBottom: nameError ? 6 : 16 }}
      />
      {nameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 16 }}>Enter a name.</div>
      )}
      {offerLogin && (
        <>
          <label htmlFor="add-person-email" style={labelStyle}>
            Email <span style={{ fontWeight: 'var(--weight-normal)' }}>(optional)</span>
          </label>
          <input
            id="add-person-email"
            type="email"
            autoComplete="off"
            placeholder="them@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          {/* The same promise the Profile screen, the invitation email and the privacy policy carry,
              stated at the moment somebody decides to hand out a login. */}
          <p style={hintStyle}>
            Add an email to send them their own login. They&rsquo;ll choose their own password
            &mdash; you&rsquo;ll be able to see their workouts and remove their login, but never see
            or set their password.
          </p>
        </>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleAdd}
          style={{
            flex: 1,
            padding: 14,
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {inviting ? 'Add and send invite' : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 14,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 16,
};

// Matches ImportDataModal's field label rather than the uppercase treatment on the auth pages.
const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
};

const hintStyle = {
  margin: '0 0 18px',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--color-muted)',
};
