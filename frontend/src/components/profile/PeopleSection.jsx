import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SectionLabel from '../shared/SectionLabel';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import Modal from '../shared/Modal';
import Button from '../shared/Button';
import AddPersonModal from '../shared/AddPersonModal';
import { IconChevronRight, IconPlus } from '../shared/icons';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useUI } from '../../context/UIContext';
import { listLogins, inviteLogin, revokeLogin, unlockLogin, setLoginRole } from '../../api/logins';
import { removePerson, updatePerson } from '../../api/people';
import { planIncludes } from '../../utils/planFeatures';
import { planCopy } from '../billing/planCopy';
import { accountVocab, managerLabel } from '../../utils/accountVocab';
import { FIELD_LIMITS } from '../../utils/fieldLimits';
import { useBillingChannel } from '../../hooks/useBillingChannel';

/**
 * Profile's People list: everybody in the household, how each of them signs in, and what they may
 * do -- one row per person, readable at a glance, with everything that CHANGES behind that row's
 * sheet.
 *
 * This used to be two sections, People (rename / remove) and Logins (invite / trust / unlock /
 * remove login), listing the same people twice. Both were already shown to exactly the same
 * viewers -- the owner and a trusted member; ProfileTab hides this whole block from a plain member
 * -- so the split bought no privacy, and it put a person's settings in two places on one screen.
 * Every finer permission below is decided per CONTROL, as it always was, so merging moved no line.
 *
 * ⚠️ TWO DATA SOURCES WITH DIFFERENT RELIABILITY, and the list must never wait on the weaker one.
 * `people` comes from the auth snapshot and is always here, offline included. The login rows are a
 * live read (`listLogins`). So the list always renders from `people`, and login facts are layered on
 * when they arrive; if that read fails the rows simply carry no login line and the intro says why.
 * The old Logins section rendered nothing at all on a failed read -- fine for a section about one
 * feature, wrong for the household's only roster.
 *
 * `plan` (AccountDto.plan, chrome only -- billing.md) is what replaces Enable-login/Resend with a
 * link to Plus on Free instead of opening an invite that `MembershipInviteService.invite` can only
 * refuse (member-access.md, bug #2). Fails OPEN on an unknown plan, same as `PlusUpsell`/`PlanBadge`.
 *
 * `isOwner` decides the controls only the OWNER may use: the Trusted toggle and Remove login on a
 * trusted login (ASSIGN_ROLES), and removing a person (REMOVE_PEOPLE). A trusted member also reaches
 * this list (MANAGE_PEOPLE, MANAGE_LOGINS) and sees the Trusted tag instead of the toggle.
 * `canWritePerson` is useAccountAccess's own answer, passed in so this renders bare in its tests.
 */
export default function PeopleSection({
  plan,
  vocab,
  people = [],
  refreshPeople,
  isOwner = true,
  canWritePerson = () => true,
}) {
  // undefined: still loading. null: the read failed. An array: the login rows.
  const [rows, setRows] = useState(undefined);
  const [openPersonId, setOpenPersonId] = useState(null);
  const [invitingPerson, setInvitingPerson] = useState(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const { run } = useGatedMutation();
  const { showToast, openConfirm } = useUI();
  const channel = useBillingChannel();

  const load = useCallback(async () => {
    try {
      setRows(await listLogins());
    } catch {
      // Deliberately no toast: a READ on a settings screen would otherwise fire on every offline
      // visit to Profile. The intro says the login details need a connection instead.
      setRows(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loginsLoaded = Array.isArray(rows);
  const loginFor = (personId) =>
    loginsLoaded ? rows.find((r) => String(r.personId) === String(personId)) : undefined;

  const canTrust = isOwner && planIncludes(plan, 'MANAGER_ROLE');
  const hasLogins = planIncludes(plan, 'MEMBER_LOGINS');
  // "Trusted" on a family account, "Assistant" on Pro (the user kept Pro's own word).
  const roleWord = managerLabel(vocab);
  const accountNoun = vocab?.account ?? 'household';

  // What THIS viewer may do on one person. Every rule here is the server's -- a control the server
  // will refuse must not be offered (member-access.md) -- and a row with nothing on it has no sheet.
  function permissionsFor(person, login) {
    return {
      rename: canWritePerson(person.id),
      // Invite / resend: anyone who is not signed in yet. On Free the sheet offers Plus instead.
      invite: Boolean(login) && login.status !== 'ACTIVE',
      unlock: Boolean(login?.lockedUntil),
      // Only an ACTIVE login that is not the owner's own -- the server refuses both other cases (409).
      trust: canTrust && login?.status === 'ACTIVE' && !login.isSelf && login.role !== 'OWNER',
      // Not the viewer's own (409: nothing could put it back), not the owner's (409), and a trusted
      // viewer may not remove another trusted login (403, ASSIGN_ROLES).
      removeLogin: Boolean(login) && login.status !== 'NONE' && !login.isSelf && login.role !== 'OWNER'
        && (isOwner || login.role !== 'MANAGER'),
      // Removing a person deletes their whole history: REMOVE_PEOPLE, owner-only, never the primary.
      removePerson: isOwner && !person.isPrimary,
    };
  }

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

  const removeLogin = run(
    async (login) => {
      await revokeLogin(login.personId);
      showToast(login.status === 'ACTIVE' ? 'Login removed.' : 'Invite withdrawn.');
      await load();
    },
    {
      offlineMessage: 'Removing a login needs a connection.',
      errorMessage: "Couldn't remove that login.",
      // The one refusal here is "you can't remove your own login", which says what to do instead.
      showServerMessage: true,
    },
  );

  const changeRole = run(
    async (login, role) => {
      await setLoginRole(login.personId, role);
      showToast(role === 'MANAGER'
        ? `${login.personName} can now log for everyone.`
        : `${login.personName} can now change only their own workouts.`);
      await load();
    },
    {
      offlineMessage: 'Changing who is trusted needs a connection.',
      errorMessage: "Couldn't change that login.",
      // Every refusal is a sentence for the owner: needs a login first, part of Plus.
      showServerMessage: true,
    },
  );

  const unlock = run(
    async (login) => {
      await unlockLogin(login.personId);
      showToast(`${login.personName} can try signing in again.`);
      await load();
    },
    {
      offlineMessage: 'Unlocking a login needs a connection.',
      errorMessage: "Couldn't unlock that login.",
    },
  );

  const rename = run(
    async (person, name) => {
      await updatePerson(person.id, name);
      await refreshPeople?.();
      // The login rows carry the name too.
      await load();
      showToast('Name saved.');
    },
    {
      offlineMessage: 'Renaming a person needs a connection.',
      errorMessage: "Couldn't save that name.",
    },
  );

  // Removing a person deletes their whole training history -- the one Tier-3 write where a silent
  // failure is most alarming, since the row simply staying put reads as "it didn't take" rather
  // than "it errored".
  const deletePerson = run(
    async (person) => {
      await removePerson(person.id);
      setOpenPersonId(null);
      await refreshPeople?.();
      await load();
    },
    {
      offlineMessage: 'Removing a person needs a connection.',
      errorMessage: "Couldn't remove that person.",
    },
  );

  // Turning it ON asks first, and says exactly what it grants -- including the one thing it does
  // not. Turning it OFF takes access away and needs no confirmation.
  function confirmTrust(login) {
    // "a trusted member" on a family account, "an assistant" on Pro -- the account's own word.
    const role = accountVocab(vocab).manager;
    const article = /^[aeiou]/i.test(role) ? 'an' : 'a';
    openConfirm(
      `They'll be able to log, edit and delete workouts for everyone in this `
        + `${accountNoun} except you. You can turn this off at any time.`,
      () => changeRole(login, 'MANAGER'),
      { title: `Make ${login.personName} ${article} ${role}?`, confirmLabel: `Make ${roleWord.toLowerCase()}` },
    );
  }

  /**
   * ⚠️ The confirm names the two things that are NOT obvious, and both are load-bearing.
   *
   * 1. The person and their workouts stay. The sheet's other "remove" deletes training data, so
   *    without this sentence an owner reasonably assumes this does too -- and hesitates over an
   *    access decision that costs nothing.
   * 2. Work queued on THEIR device may never sync. A revoked member who is offline cannot be
   *    reached; on reconnect their token resolves to no membership and the session tears down with
   *    those writes undeliverable. There is no server-side fix (offline-internals.md), so the
   *    honest thing is to say so before the owner acts, not after.
   */
  function confirmRemoveLogin(login) {
    const active = login.status === 'ACTIVE';
    const message = active
      ? `${login.personName} and all of their workouts stay in this ${accountNoun} — only their ability `
        + `to sign in goes away. If they're offline right now, anything they haven't synced yet `
        + `may not make it.`
      : `The link in their email will stop working.`;
    // Not "Delete": this dialog's whole job is telling the owner nothing is deleted.
    openConfirm(message, () => removeLogin(login), {
      title: active ? `Remove ${login.personName}'s login?` : `Withdraw ${login.personName}'s invite?`,
      confirmLabel: active ? 'Remove login' : 'Withdraw invite',
    });
  }

  function confirmRemovePerson(person) {
    openConfirm(
      "This permanently deletes all of their sessions, sets, routines, and setup values. This can't be undone.",
      () => deletePerson(person),
      { title: `Remove ${person.name}?` },
    );
  }

  const openPerson = people.find((p) => String(p.id) === String(openPersonId));

  return (
    <>
      <SectionLabel>People</SectionLabel>
      {/* data-testid because a person's name collides with PersonPillBar's own button for that same
          person -- both legitimately render "Sam" whenever a household has 2+ people, so an
          unscoped getByText('Sam') is ambiguous the instant both have mounted. */}
      <div style={cardStyle} data-testid="people-list">
        <div style={introStyle}>
          <p style={{ margin: 0 }}>
            Everyone here keeps their own workouts. Give someone a login so they can sign in on their
            own device &mdash; they&rsquo;ll see everyone&rsquo;s workouts but change only their own.
            {canTrust && <> Make someone <strong>{roleWord}</strong> to let them log for everyone.</>}
          </p>
          {/* One line for the whole list rather than an upsell on every row without a login: on Free
              that is nearly every row, and the same link repeated down the list is noise. */}
          {!hasLogins && (
            channel === 'none' ? (
              <p style={introNoteStyle}>Logins for other people are part of Plus.</p>
            ) : (
              <p style={introNoteStyle}>
                Logins for other people are part of Plus.{' '}
                {/* Not OfflineDisabledWrap'd: a navigation, not a write -- same as PlanBadge's
                    "Go Plus". Reuses the header pill's own class rather than a one-off style. */}
                <Link to="/app/billing" className="pressable plan-badge plan-badge--upgrade">
                  Unlock with Plus
                </Link>
              </p>
            )
          )}
          {rows === null && (
            <p style={introNoteStyle}>Login details need a connection. Everyone is still listed.</p>
          )}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <OfflineDisabledWrap message="Adding a person needs a connection.">
              {/* ⚠️ "Add a person", not "+ Add person": the person bar keeps that label and is on
                  this same screen for a household of two or more, and ~20 specs click it by name.
                  Playwright matches names by substring, so sharing it makes every one ambiguous. */}
              <button
                className="btn btn-secondary btn-sm pressable"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
                onClick={() => setAddingPerson(true)}
              >
                <IconPlus size={14} aria-hidden="true" />
                Add a person
              </button>
            </OfflineDisabledWrap>
          </div>
        </div>

        {people.map((person) => {
          const login = loginFor(person.id);
          const can = permissionsFor(person, login);
          const editable = Object.values(can).some(Boolean);
          return (
            <PersonRow
              key={person.id}
              person={person}
              login={login}
              roleWord={roleWord}
              onOpen={editable ? () => setOpenPersonId(person.id) : null}
            />
          );
        })}
      </div>

      {openPerson && (
        <PersonSheet
          // Keyed by person: the name field's draft belongs to the person it was typed for.
          key={openPerson.id}
          person={openPerson}
          login={loginFor(openPerson.id)}
          loginsFailed={rows === null}
          can={permissionsFor(openPerson, loginFor(openPerson.id))}
          hasLogins={hasLogins}
          channel={channel}
          roleWord={roleWord}
          accountNoun={accountNoun}
          onClose={() => setOpenPersonId(null)}
          onRename={(name) => rename(openPerson, name)}
          onInvite={(login) => {
            setOpenPersonId(null);
            setInvitingPerson(login);
          }}
          onUnlock={unlock}
          onTrustChange={(login, on) => (on ? confirmTrust(login) : changeRole(login, 'MEMBER'))}
          onRemoveLogin={confirmRemoveLogin}
          onRemovePerson={() => confirmRemovePerson(openPerson)}
        />
      )}
      {addingPerson && (
        <AddPersonModal
          offerLogin={hasLogins}
          onAdded={load}
          onClose={() => setAddingPerson(false)}
        />
      )}
      {invitingPerson && (
        <InviteModal
          plan={plan}
          vocab={vocab}
          person={invitingPerson}
          onCancel={() => setInvitingPerson(null)}
          onSend={(email) => sendInvite(invitingPerson.personId, email)}
        />
      )}
    </>
  );
}

/**
 * Tags, in reading order: who they are to this viewer, then what their login lets them do, then
 * anything wrong with it right now. The detail line under the name says HOW they sign in.
 */
function personTags(person, login, roleWord) {
  const tags = [];
  if (login?.isSelf) tags.push({ key: 'you', label: 'You' });
  if (login?.role === 'OWNER') tags.push({ key: 'owner', label: 'Owner' });
  else if (person.isPrimary) tags.push({ key: 'primary', label: 'Primary' });
  if (login?.role === 'MANAGER') tags.push({ key: 'trusted', label: roleWord, tone: 'trusted' });
  if (login?.status === 'INVITED') tags.push({ key: 'invited', label: 'Invited', tone: 'invited' });
  // ⚠️ Shown BESIDE the status, never instead of it: an ACTIVE login that is locked is still a
  // login, and it clears itself in fifteen minutes. Collapsing the two would leave the owner unable
  // to see "they have a login AND cannot use it right now" -- the single most common reason a member
  // says signing in is broken.
  if (login?.lockedUntil) tags.push({ key: 'locked', label: 'Locked', tone: 'locked' });
  return tags;
}

function loginDetail(login) {
  if (!login) return null;
  // The address is shown back because the owner typed it -- without it they cannot tell which of
  // two similar addresses they used.
  if (login.status === 'ACTIVE') return `Signs in as ${login.email}`;
  if (login.status === 'INVITED') return `Invite sent to ${login.email}`;
  return 'No login';
}

function PersonRow({ person, login, roleWord, onOpen }) {
  const detail = loginDetail(login);
  const content = (
    <>
      <span className="person-row__avatar" aria-hidden="true">
        {person.name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="person-row__main">
        <span className="person-row__name">
          <span>{person.name}</span>
          {personTags(person, login, roleWord).map((tag) => (
            <span key={tag.key} className={`person-tag${tag.tone ? ` person-tag--${tag.tone}` : ''}`}>
              {tag.label}
            </span>
          ))}
        </span>
        {detail && (
          <span className="person-row__detail" title={login?.email ?? undefined} style={{ display: 'block' }}>
            {detail}
          </span>
        )}
      </span>
    </>
  );

  // Hidden, not disabled, on a row this viewer can change nothing about -- a trusted member on the
  // owner's row. Nothing they could do would ever enable it (member-access.md's "Hide" column).
  if (!onOpen) {
    return <div className="person-row" data-testid={`person-row-${person.id}`}>{content}</div>;
  }
  // The whole row is the target: an iPad mid-workout wants a big one. Not OfflineDisabledWrap'd --
  // opening the sheet is not a write, and every write inside it carries its own gate.
  return (
    <button
      type="button"
      className="person-row pressable"
      data-testid={`person-row-${person.id}`}
      aria-label={`Edit ${person.name}`}
      onClick={onOpen}
    >
      {content}
      <span className="person-row__edit" aria-hidden="true">
        Edit <IconChevronRight size={16} />
      </span>
    </button>
  );
}

/**
 * Everything that can be changed about one person, grouped by what it changes: their name, their
 * login, and -- apart and last -- removing them. Every control is the same gated write it was on the
 * old two-section screen; only where it sits has changed.
 *
 * ⚠️ "Remove login" and "Remove {name}" are both in here, in separate blocks with separate
 * explanations. The first deletes nothing; the second deletes every session, set and routine the
 * person has. They were in two different sections before for exactly this reason, so the blocks,
 * the wording beside each and the confirm dialogs are what keep them apart now.
 */
function PersonSheet({
  person,
  login,
  loginsFailed,
  can,
  hasLogins,
  channel,
  roleWord,
  accountNoun,
  onClose,
  onRename,
  onInvite,
  onUnlock,
  onTrustChange,
  onRemoveLogin,
  onRemovePerson,
}) {
  const [name, setName] = useState(person.name);
  const [nameError, setNameError] = useState(false);
  const changed = name.trim() !== person.name;

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return undefined;
    }
    return onRename(trimmed);
  }

  return (
    // initialFocus="dialog": landing on the Name field would raise the keyboard on an iPhone every
    // time the sheet opens, and most visits are to look or to flip Trusted, not to rename.
    <Modal width={420} onClose={onClose} title={person.name} initialFocus="dialog">
      {can.rename && (
        <section className="person-sheet__block" aria-label="Name">
          <SectionLabel as="h3" style={sheetHeadingStyle}>Name</SectionLabel>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                aria-label="Name"
                className="input"
                value={name}
                maxLength={FIELD_LIMITS.personName}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(false);
                }}
                style={nameError ? { borderColor: 'var(--color-danger)' } : undefined}
              />
              {nameError && <div style={fieldErrorStyle}>Enter a name.</div>}
            </div>
            <OfflineDisabledWrap message="Renaming a person needs a connection.">
              <Button size="md" onClick={saveName} disabled={!changed}>
                Save
              </Button>
            </OfflineDisabledWrap>
          </div>
        </section>
      )}

      <section className="person-sheet__block" aria-label="Login">
        <SectionLabel as="h3" style={sheetHeadingStyle}>Login</SectionLabel>
        <LoginBlock
          person={person}
          login={login}
          loginsFailed={loginsFailed}
          can={can}
          hasLogins={hasLogins}
          channel={channel}
          roleWord={roleWord}
          accountNoun={accountNoun}
          onInvite={onInvite}
          onUnlock={onUnlock}
          onTrustChange={onTrustChange}
          onRemoveLogin={onRemoveLogin}
        />
      </section>

      {can.removePerson && (
        <section className="person-sheet__block" aria-label="Remove person">
          <SectionLabel as="h3" style={sheetHeadingStyle}>Danger zone</SectionLabel>
          <p className="person-sheet__text">
            Permanently deletes {person.name} and every workout, routine and setup value they have.
          </p>
          <OfflineDisabledWrap message="Removing a person needs a connection.">
            <Button variant="danger" size="sm" onClick={onRemovePerson}>
              Remove {person.name}
            </Button>
          </OfflineDisabledWrap>
        </section>
      )}
    </Modal>
  );
}

function LoginBlock({
  person,
  login,
  loginsFailed,
  can,
  hasLogins,
  channel,
  roleWord,
  accountNoun,
  onInvite,
  onUnlock,
  onTrustChange,
  onRemoveLogin,
}) {
  if (!login) {
    return (
      <p className="person-sheet__text" style={{ marginBottom: 0 }}>
        {loginsFailed ? 'Login details need a connection.' : 'Loading…'}
      </p>
    );
  }

  const removeLoginButton = can.removeLogin && (
    <OfflineDisabledWrap message="Removing a login needs a connection.">
      {/* ⚠️ "Remove login" / "Withdraw invite", never bare "Remove": the Danger zone below has
          "Remove {name}", which deletes the person with every session, set and routine they own. */}
      <Button variant="danger" size="sm" onClick={() => onRemoveLogin(login)}>
        {login.status === 'ACTIVE' ? 'Remove login' : 'Withdraw invite'}
      </Button>
    </OfflineDisabledWrap>
  );

  // Not OfflineDisabledWrap'd: a navigation, not a write. In an app with no store to sell through
  // there is nowhere to send them (billing channel 'none'): say why, link nothing.
  const plusLink = channel === 'none' ? (
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>Part of Plus</span>
  ) : (
    <Link to="/app/billing" className="pressable plan-badge plan-badge--upgrade">
      Unlock with Plus
    </Link>
  );

  if (login.status === 'NONE') {
    return (
      <>
        <p className="person-sheet__text">
          {person.name} doesn&rsquo;t have a login, so their workouts are logged from a shared device.
        </p>
        <div className="person-sheet__actions">
          {hasLogins ? (
            <OfflineDisabledWrap message="Sending an invite needs a connection.">
              <Button size="sm" onClick={() => onInvite(login)}>Enable login</Button>
            </OfflineDisabledWrap>
          ) : plusLink}
        </div>
      </>
    );
  }

  if (login.status === 'INVITED') {
    return (
      <>
        <p className="person-sheet__text">
          Invite sent to <strong style={{ color: 'var(--color-text)' }}>{login.email}</strong>. Nothing
          changes until they open it.
        </p>
        <div className="person-sheet__actions">
          {hasLogins ? (
            <OfflineDisabledWrap message="Sending an invite needs a connection.">
              <Button size="sm" onClick={() => onInvite(login)}>Resend</Button>
            </OfflineDisabledWrap>
          ) : plusLink}
          {removeLoginButton}
        </div>
      </>
    );
  }

  // ACTIVE
  return (
    <>
      <p className="person-sheet__text">
        Signs in as <strong style={{ color: 'var(--color-text)' }}>{login.email}</strong>
        {login.isSelf && ' — this is you'}.
      </p>
      {login.lockedUntil && (
        <div className="person-sheet__notice" role="status">
          Locked out after too many wrong passwords. It clears itself after fifteen minutes, or you
          can unlock it now.
          <div style={{ marginTop: 'var(--space-2)' }}>
            <OfflineDisabledWrap message="Unlocking a login needs a connection.">
              <Button size="sm" onClick={() => onUnlock(login)}>Unlock</Button>
            </OfflineDisabledWrap>
          </div>
        </div>
      )}
      {/* The owner's Trusted toggle. The label is the word plus what it means, and it names the
          person -- so nobody has to guess what "Trusted" grants, or whom. */}
      {can.trust && (
        <label className="person-sheet__toggle">
          <OfflineDisabledWrap message="Changing who is trusted needs a connection.">
            <input
              type="checkbox"
              checked={login.role === 'MANAGER'}
              onChange={(e) => onTrustChange(login, e.target.checked)}
              aria-label={`${roleWord}: ${person.name}`}
              style={{ width: 18, height: 18, margin: '1px 0 0', accentColor: 'var(--color-accent-strong)' }}
            />
          </OfflineDisabledWrap>
          <span>
            <strong>{roleWord}</strong>
            <br />
            {person.name} can log workouts for everyone in the {accountNoun}, except you.
          </span>
        </label>
      )}
      {/* Everyone but the owner (who has the toggle) is told who is trusted in words. */}
      {!can.trust && login.role === 'MANAGER' && (
        <p className="person-sheet__text">
          <strong style={{ color: 'var(--color-text)' }}>{roleWord}</strong> &mdash; can log workouts
          for everyone in the {accountNoun}.
        </p>
      )}
      {can.removeLogin && (
        <>
          <p className="person-sheet__text">
            Removing the login keeps {person.name} and all of their workouts here.
          </p>
          <div className="person-sheet__actions">{removeLoginButton}</div>
        </>
      )}
    </>
  );
}

function InviteModal({ person, plan, vocab, onCancel, onSend }) {
  const [email, setEmail] = useState(person.email || '');
  // This modal is unreachable without MEMBER_LOGINS, so `plan` is always a paid tier here -- but
  // name it from planCopy rather than as a literal, because a trainer who pays for Pro being told
  // that logins "are part of Plus" describes a plan they did not buy. Falls back to the plain word
  // when a newer server names a tier this bundle predates (resilience.md axis D).
  const planName = planCopy(plan)?.name ?? 'your plan';
  const account = vocab?.account ?? 'household';

  return (
    <Modal title={`Enable login for ${person.personName}`} onClose={onCancel}>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-muted)', marginBottom: 16 }}>
        We&rsquo;ll email {person.personName} a link to set up their own login. Nothing changes until
        they open it.
      </div>

      {/* ⚠️ Stated BEFORE the email field, deliberately -- these are the things worth knowing
          before you type somebody's address, not after. The plan calls for all three. */}
      <ul style={disclosureStyle}>
        <li>Member logins are part of {planName}. If this {account} goes back to Free the login
          stops working until you upgrade again — {person.personName}&rsquo;s workouts are
          never deleted either way.</li>
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
  borderRadius: 16,
  padding: '4px 20px',
  marginBottom: 24,
};

const introStyle = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--color-muted)',
  padding: '16px 0',
  borderBottom: '1px solid var(--color-subtle-bg)',
};

const introNoteStyle = {
  margin: 'var(--space-2) 0 0',
};

// A heading inside the sheet: SectionLabel's own recipe, without the page-level top margin.
const sheetHeadingStyle = {
  margin: '0 0 var(--space-2)',
};

const fieldErrorStyle = {
  marginTop: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-danger)',
};

// Matches ImportDataModal's field label rather than the uppercase treatment on the auth pages.
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
