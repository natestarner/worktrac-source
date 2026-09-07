import { useCallback, useEffect, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import Modal from '../shared/Modal';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useUI } from '../../context/UIContext';
import { listLogins, inviteLogin } from '../../api/logins';

/**
 * The owner's login manager: who in this household can sign in, and inviting the ones who cannot.
 *
 * Owner-only, and HIDDEN rather than disabled for a member — same reasoning as the People roster
 * above it in ProfileTab. A member has no path to any of this, so a greyed-out list of controls
 * they can never use is noise that also invites "why not?". Disabling is for something you could
 * do under other circumstances.
 */
export default function LoginsSection() {
  const [rows, setRows] = useState(null);
  const [invitingPerson, setInvitingPerson] = useState(null);
  const { run } = useGatedMutation();
  const { showToast } = useUI();

  const load = useCallback(async () => {
    try {
      setRows(await listLogins());
    } catch {
      // Deliberately quiet: this is a READ on a settings screen, and the section simply does not
      // render until it succeeds. A toast here would fire on every offline visit to Profile for a
      // feature the person was not asking about.
      setRows(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvite = run(
    async (personId, email) => {
      await inviteLogin(personId, email);
      setInvitingPerson(null);
      showToast('Invite sent.');
      await load();
    },
    {
      offlineMessage: 'Sending an invite needs a connection.',
      errorMessage: "Couldn't send that invite.",
      // The refusals here are written for a person and say what to do: that person already has a
      // login, or the invite was just sent and is still cooling down.
      showServerMessage: true,
    },
  );

  if (!rows) return null;

  return (
    <>
      <SectionLabel>Logins</SectionLabel>
      <div style={cardStyle}>
        <div style={introStyle}>
          Give someone their own email and password so they can log their own workouts. They&rsquo;ll
          see everyone&rsquo;s workouts but can only change their own.
        </div>
        {rows.map((row, i) => (
          <div
            key={row.personId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 0',
              borderBottom: i < rows.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{row.personName}</div>
              {/* The address is shown back because the owner typed it -- without it they cannot
                  tell which of two similar addresses they used. */}
              {row.email && (
                <div style={emailStyle} title={row.email}>
                  {row.email}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              {row.status === 'ACTIVE' && <span style={activeBadgeStyle}>HAS LOGIN</span>}
              {row.status === 'INVITED' && <span style={invitedBadgeStyle}>INVITED</span>}
              {row.status !== 'ACTIVE' && (
                <OfflineDisabledWrap message="Sending an invite needs a connection.">
                  <button onClick={() => setInvitingPerson(row)} style={linkStyle}>
                    {row.status === 'INVITED' ? 'Resend' : 'Enable login'}
                  </button>
                </OfflineDisabledWrap>
              )}
            </div>
          </div>
        ))}
      </div>

      {invitingPerson && (
        <InviteModal
          person={invitingPerson}
          onCancel={() => setInvitingPerson(null)}
          onSend={(email) => sendInvite(invitingPerson.personId, email)}
        />
      )}
    </>
  );
}

function InviteModal({ person, onCancel, onSend }) {
  const [email, setEmail] = useState(person.email || '');

  return (
    <Modal title={`Enable login for ${person.personName}`} onClose={onCancel}>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-muted)', marginBottom: 16 }}>
        We&rsquo;ll email {person.personName} a link to set up their own login. Nothing changes until
        they open it.
      </div>

      {/* ⚠️ Stated BEFORE the email field, deliberately -- these are the things worth knowing
          before you type somebody's address, not after. The plan calls for all three. */}
      <ul style={disclosureStyle}>
        <li>Member logins are part of Pro. If this household goes back to Free the login stops
          working until you upgrade again — {person.personName}&rsquo;s workouts are never deleted
          either way.</li>
        <li>You can see their workouts and can remove their login at any time. You will never be
          able to see or set their password.</li>
        <li>If {person.personName} is under 13, set this up with a parent or guardian and use an
          address one of them can reach.</li>
      </ul>

      <label htmlFor="invite-email" style={labelStyle}>Email</label>
      <input
        id="invite-email"
        type="email"
        autoComplete="off"
        placeholder="them@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input"
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button
          onClick={() => onSend(email.trim())}
          disabled={!email.trim()}
          className="btn btn-primary btn-full pressable"
        >
          Send invite
        </button>
        <button onClick={onCancel} style={cancelStyle}>Cancel</button>
      </div>
    </Modal>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: '4px 16px 8px',
  marginBottom: 24,
};

const introStyle = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--color-muted)',
  padding: '14px 0 4px',
};

const emailStyle = {
  fontSize: 13,
  color: 'var(--color-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 220,
};

const badgeBase = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '3px 7px',
  borderRadius: 5,
};

const activeBadgeStyle = { ...badgeBase, background: 'var(--color-subtle-bg)', color: 'var(--color-muted)' };
const invitedBadgeStyle = { ...badgeBase, background: 'var(--color-accent-soft, var(--color-subtle-bg))', color: 'var(--color-accent-text)' };

const linkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-accent-text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

// Matches ImportDataModal's field label rather than the uppercase treatment on the auth pages.
// The uppercase idiom belongs to <SectionLabel>, which is a heading ABOVE a group of content; the
// two in-app modals an owner uses should also read the same as each other. check-design-primitives
// enforces the first half of that.
const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
};

const disclosureStyle = {
  margin: '0 0 18px',
  padding: '12px 16px 12px 30px',
  background: 'var(--color-subtle-bg)',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--color-muted)',
  display: 'grid',
  gap: 8,
};

const cancelStyle = {
  padding: '12px 18px',
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text)',
  cursor: 'pointer',
};
