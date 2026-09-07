import { useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useUI } from '../../context/UIContext';
import { removePerson } from '../../api/people';
import EditPersonModal from './EditPersonModal';
import DeleteAccountModal from './DeleteAccountModal';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import { useAccountAccess } from '../../hooks/useAccountAccess';

export default function ProfileTab() {
  const { user, account, people, refreshPeople } = useAuth();
  const { isMember, selfPersonId } = useAccountAccess();
  const { openConfirm } = useUI();
  const navigate = useNavigate();
  const primary = people.find((p) => p.isPrimary);
  const self = people.find((p) => String(p.id) === String(selfPersonId));
  const [editingPerson, setEditingPerson] = useState(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const { run } = useGatedMutation();

  // Removing a person deletes their whole training history -- the one Tier-3 write where a silent
  // failure is most alarming, since the row simply staying put reads as "it didn't take" rather
  // than "it errored". Now gated and reported like every other one.
  const handleRemovePerson = run(
    async (person) => {
      await removePerson(person.id);
      refreshPeople();
    },
    {
      offlineMessage: 'Removing a person needs a connection.',
      errorMessage: "Couldn't remove that person.",
    },
  );

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      {/* "Account holder" is the owner's framing and is actively wrong for a member: user.email
          is the MEMBER's own address, so that heading would sit above their email describing
          somebody else. A member gets their own identity instead.

          Neither variant names the owner. Doing so would need a new field on MembershipDto -- /me
          returns no owner name today -- and widening an auth response is not something to slip in
          alongside a UI change. Flagged in the plan for Nate. */}
      <SectionLabel>{isMember ? 'You' : 'Account holder'}</SectionLabel>
      <div style={cardStyle}>
        <Field label="Name" value={isMember ? self?.name : primary?.name} />
        <Field label="Household" value={account?.name} />
        <Field label="Email" value={user?.email} last />
      </div>

      {/* Everything below is household management, which is MANAGE_PEOPLE / DELETE_ACCOUNT and
          therefore owner-only. Hidden rather than disabled: a member has no path to any of it, so
          showing a greyed-out roster of controls they can never use is noise that also invites
          "why not?". Disabling is for something you could do under other circumstances -- see
          ReadOnlyWrap, which is exactly that case.

          The server refuses all of it regardless (PersonController's MANAGE_PEOPLE, and
          AccountController's DELETE_ACCOUNT); this only stops the client offering it. */}
      {!isMember && (
        <>
      <SectionLabel>People</SectionLabel>
      <div style={cardStyle}>
        {people.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderBottom: i < people.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
              {p.isPrimary && <span style={badgeStyle}>PRIMARY</span>}
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <OfflineDisabledWrap message="Editing needs a connection.">
                <button onClick={() => setEditingPerson(p)} style={editLinkStyle}>
                  Edit
                </button>
              </OfflineDisabledWrap>
              {!p.isPrimary && (
                <OfflineDisabledWrap message="Removing a person needs a connection.">
                  <button
                    onClick={() =>
                      openConfirm(`Remove ${p.name}? This deletes all of their sessions, sets, routines, and setup values.`, () => handleRemovePerson(p))
                    }
                    style={deleteLinkStyle}
                  >
                    Remove
                  </button>
                </OfflineDisabledWrap>
              )}
            </div>
          </div>
        ))}
      </div>

      <SectionLabel>Danger zone</SectionLabel>
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 0',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Delete account</div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
              Permanently deletes all data for everyone on this account.
            </div>
          </div>
          <OfflineDisabledWrap message="Deleting your account needs a connection.">
            <button onClick={() => setShowDeleteAccount(true)} style={deleteLinkStyle}>
              Delete
            </button>
          </OfflineDisabledWrap>
        </div>
      </div>

        </>
      )}

      {editingPerson && <EditPersonModal person={editingPerson} onClose={() => setEditingPerson(null)} />}
      {showDeleteAccount && <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} />}
    </div>
  );
}

function Field({ label, value, last }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--color-subtle-bg)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 0 var(--space-3) 0',
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '4px 20px',
  marginBottom: 24,
};

const badgeStyle = {
  fontSize: 11,
  fontWeight: 'var(--weight-bold)',
  color: 'var(--color-muted)',
  background: 'var(--color-subtle-bg)',
  padding: '3px 8px',
  borderRadius: 999,
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
