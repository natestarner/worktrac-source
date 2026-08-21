import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../shared/Button';
import Card from '../shared/Card';
import Input from '../shared/Input';
import SectionLabel from '../shared/SectionLabel';
import SegmentedToggle from '../shared/SegmentedToggle';
import TextArea from '../shared/TextArea';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import { sendContactMessage } from '../../api/contact';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOutboxCount } from '../../hooks/useOutboxCount';
import { clearClientError, formatClientError, readClientError } from '../../lib/lastClientError';

const CATEGORIES = [
  { label: 'Suggestion', value: 'SUGGESTION' },
  { label: 'Bug', value: 'BUG' },
  { label: 'Other', value: 'OTHER' },
];

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 10;

// Injected by vite.config.js's `define`. Guarded because Vitest transforms this file without that
// define in place, and a bare reference to an undeclared global is a ReferenceError, not undefined.
const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

// The Contact Us page, reached from the profile dropdown. Mirrors ProfileTab/AppSettingsTab's
// shape (back link, section label, card) but builds it out of the primitives rather than their
// pre-token local style objects.
//
// The submit is deliberately Tier-3 (useGatedMutation + OfflineDisabledWrap), not durable: see
// api/contact.js. What makes that acceptable rather than lossy is that the draft is persisted per
// person, so refusing offline costs the person nothing -- their text is still there when they come
// back online.
export default function ContactTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activePersonId, contactDraft, setContactDraft, clearContactDraft } = useAppState();
  const { showToast } = useUI();
  const online = useOnlineStatus();
  const unsyncedWrites = useOutboxCount();
  const { pending, run } = useGatedMutation();

  const [sent, setSent] = useState(false);
  const [subjectError, setSubjectError] = useState('');
  const [messageError, setMessageError] = useState('');

  const category = contactDraft?.category ?? 'SUGGESTION';
  const subject = contactDraft?.subject ?? '';
  const message = contactDraft?.message ?? '';

  // Read once per mount: the person is looking at a snapshot of what will be sent, and it must not
  // change under them while they type.
  const clientError = useMemo(() => readClientError(), []);

  // Where they were when they opened the menu, passed through by UserMenu. Falls back to the
  // current route for a direct navigation (a bookmark, or a restored lastTab after reload).
  const screen = location.state?.from ?? location.pathname;

  function patchDraft(patch) {
    setContactDraft({ category, subject, message, ...patch });
  }

  const handleSend = run(
    async () => {
      const trimmedSubject = subject.trim();
      const trimmedMessage = message.trim();

      // Validated up front and reported per field, matching RegisterPage. The backend enforces the
      // same bounds -- this exists so the person doesn't spend a round trip to learn it.
      let invalid = false;
      if (!trimmedSubject) {
        setSubjectError('Add a short subject.');
        invalid = true;
      }
      if (trimmedMessage.length < MESSAGE_MIN) {
        setMessageError(`Tell us a little more — at least ${MESSAGE_MIN} characters.`);
        invalid = true;
      }
      if (invalid) return;

      await sendContactMessage({
        category,
        subject: trimmedSubject,
        message: trimmedMessage,
        personId: activePersonId,
        diagnostics: {
          appBuild: APP_BUILD,
          screen,
          wasOnline: online,
          unsyncedWrites,
          clientError: formatClientError(clientError),
        },
      });

      // Only on success. A failed send leaves the draft exactly where it was -- useGatedMutation
      // has already shown the error toast, and the person can retry without retyping.
      clearContactDraft();
      clearClientError();
      setSent(true);
      showToast('Thanks — your message is on its way.');
    },
    {
      offlineMessage: 'Sending a message needs a connection.',
      errorMessage: "Couldn't send that message. Your draft is still here.",
    },
  );

  if (sent) {
    return (
      <div>
        <BackLink onClick={() => navigate(-1)} />
        <SectionLabel style={sectionLabelSpacing}>Contact us</SectionLabel>
        <Card>
          <div role="status" style={sentPanelStyle}>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>Message sent</div>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-muted)' }}>
              Thanks for taking the time. We read every one of these.
            </div>
          </div>
          <Button onClick={() => setSent(false)} fullWidth>
            Send another
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <BackLink onClick={() => navigate(-1)} />
      <SectionLabel style={sectionLabelSpacing}>Contact us</SectionLabel>

      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <p style={introStyle}>
          Found a bug, or thought of something that would make Huddle better? Tell us here.
        </p>

        <div style={fieldStyle}>
          <label style={labelStyle}>What&rsquo;s this about?</label>
          <SegmentedToggle
            options={CATEGORIES}
            value={category}
            onChange={(value) => patchDraft({ category: value })}
            ariaLabel="What's this about?"
            fill
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="contact-subject">
            Subject
          </label>
          <Input
            id="contact-subject"
            value={subject}
            maxLength={SUBJECT_MAX}
            placeholder="e.g. Rest timer resets when I switch tabs"
            error={subjectError}
            onChange={(e) => {
              patchDraft({ subject: e.target.value });
              if (subjectError) setSubjectError('');
            }}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="contact-message">
            Details
          </label>
          <TextArea
            id="contact-message"
            value={message}
            rows={7}
            maxLength={MESSAGE_MAX}
            placeholder="What happened, and what did you expect instead?"
            error={messageError}
            onChange={(e) => {
              patchDraft({ message: e.target.value });
              if (messageError) setMessageError('');
            }}
          />
          <CharacterCount length={message.length} max={MESSAGE_MAX} />
        </div>

        <WhatGetsSent
          appBuild={APP_BUILD}
          screen={screen}
          online={online}
          unsyncedWrites={unsyncedWrites}
          clientError={clientError}
        />

        <OfflineDisabledWrap message="Sending a message needs a connection.">
          <Button variant="primary" size="lg" fullWidth onClick={handleSend} disabled={pending}>
            Send message
          </Button>
        </OfflineDisabledWrap>
      </Card>
    </div>
  );
}

// The disclosure. Diagnostics make a bug report actionable, but attaching them silently would mean
// the person doesn't know what they're sending -- so everything captured is listed here in plain
// language, collapsed by default so it doesn't crowd the form.
function WhatGetsSent({ appBuild, screen, online, unsyncedWrites, clientError }) {
  const [open, setOpen] = useState(false);
  const rows = [
    ['App version', appBuild],
    ['Screen you came from', screen],
    ['Connection', online ? 'Online' : 'Offline'],
    ['Changes waiting to sync', String(unsyncedWrites)],
    ['Browser', typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent],
  ];
  if (clientError) {
    rows.push(['Last error', `${clientError.message} (${clientError.route ?? 'unknown screen'})`]);
  }

  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable"
        style={discloseButtonStyle}
      >
        What gets sent with this {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={discloseBodyStyle}>
          {rows.map(([label, value]) => (
            <div key={label} style={discloseRowStyle}>
              <span style={{ color: 'var(--color-muted)' }}>{label}</span>
              <span style={discloseValueStyle}>{value}</span>
            </div>
          ))}
          <p style={{ margin: 0, marginTop: 'var(--space-3)', color: 'var(--color-muted)' }}>
            Your name and email come from your account. Nothing else is collected.
          </p>
        </div>
      )}
    </div>
  );
}

// Appears only near the limit -- a counter sitting there from the first keystroke reads as a
// constraint to work around rather than a limit that is nowhere near being hit.
function CharacterCount({ length, max }) {
  if (length < max * 0.8) return null;
  return (
    <div style={{ ...countStyle, color: length >= max ? 'var(--color-danger)' : 'var(--color-muted)' }}>
      {length} / {max}
    </div>
  );
}

function BackLink({ onClick }) {
  return (
    <button onClick={onClick} className="pressable" style={backButtonStyle}>
      &larr; Back
    </button>
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

const introStyle = {
  margin: 0,
  marginBottom: 'var(--space-5)',
  fontSize: 'var(--text-base)',
  color: 'var(--color-muted)',
  lineHeight: 'var(--leading-normal)',
};

// .section-label carries no margin of its own -- see index.css.
const sectionLabelSpacing = { marginBottom: 'var(--space-3)' };

const fieldStyle = { marginBottom: 'var(--space-5)' };

const labelStyle = {
  display: 'block',
  marginBottom: 'var(--space-2)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
};

const countStyle = {
  marginTop: 'var(--space-1)',
  fontSize: 'var(--text-xs)',
  textAlign: 'right',
};

const discloseButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  minHeight: 40,
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};

const discloseBodyStyle = {
  marginTop: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--color-subtle-bg)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
};

const discloseRowStyle = {
  display: 'flex',
  gap: 'var(--space-3)',
  justifyContent: 'space-between',
  padding: 'var(--space-1) 0',
};

const discloseValueStyle = {
  color: 'var(--color-text)',
  textAlign: 'right',
  wordBreak: 'break-word',
  maxWidth: '65%',
};

const sentPanelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-4)',
  marginBottom: 'var(--space-5)',
  background: 'var(--color-success-bg)',
  border: '1px solid var(--color-success)',
  borderRadius: 'var(--radius-md)',
};
