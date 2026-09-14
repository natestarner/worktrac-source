import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { queryKeys } from '../../api/queryKeys';
import { addCheckIn, listCheckIns, removeCheckIn } from '../../api/checkIns';
import { accountVocab } from '../../utils/accountVocab';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import SectionLabel from '../shared/SectionLabel';
import Card from '../shared/Card';
import Button from '../shared/Button';
import Skeleton from '../shared/Skeleton';
import EmptyState from '../shared/EmptyState';
import IconButton from '../shared/IconButton';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import { IconClose } from '../shared/icons';

/**
 * Check-ins for the ACTIVE person: a weigh-in, a note, or both.
 *
 * ⚠️ THE WORD "NOTE" IS NEVER A LABEL HERE. This is the third note concept in the app —
 * `person_exercise.note` is the "standing note" on an exercise and `session_exercise_notes` is the
 * "note for this session" — and "Notes" already appears on screens this shares a suite with.
 * Playwright matches accessible names as a case-insensitive substring, so a "Private note" control
 * would break unrelated specs and read as a fourth concept. Visibility is a PROPERTY of a check-in.
 *
 * ⚠️ Writing one is TIER-3 GATED, never durable: the POST has no idempotency key, so a replay would
 * record the same weigh-in twice. The draft is persisted per person so refusing offline costs
 * nothing typed — a gate over free text without that is the silently-lost outcome the contract
 * forbids.
 */
export default function CheckInsTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account, people } = useAuth();
  const { activePersonId, checkInDraft, setCheckInDraft, clearCheckInDraft } = useAppState();
  const { canWritePerson, isMember } = useAccountAccess();
  const { run, pending } = useGatedMutation();

  const vocab = accountVocab(account?.vocab);
  const person = people.find((p) => String(p.id) === String(activePersonId));
  const draft = checkInDraft ?? { bodyWeight: '', note: '', visibleToPerson: true };

  const { data: entries, isLoading, isError } = useQuery({
    queryKey: queryKeys.checkIns(activePersonId),
    queryFn: () => listCheckIns(activePersonId),
    enabled: activePersonId != null,
  });

  // A member can only ever write on themselves; the server agrees, so this hides rather than
  // disables — a control somebody can never use under any circumstances is noise.
  const mayWrite = canWritePerson(activePersonId);
  // Only staff may keep something back. A person cannot hide an entry from themselves, and the
  // server forces that regardless of what is sent.
  const mayKeepPrivate = !isMember;

  const save = run(
    async () => {
      const weight = draft.bodyWeight === '' ? null : Number(draft.bodyWeight);
      await addCheckIn(activePersonId, {
        bodyWeight: Number.isNaN(weight) ? null : weight,
        bodyWeightUnit: account?.defaultUnit || 'lb',
        note: draft.note.trim() === '' ? null : draft.note.trim(),
        visibleToPerson: mayKeepPrivate ? draft.visibleToPerson : true,
      });
      // ⚠️ Cleared ONLY after the save lands. On a failure the draft stays exactly as typed, which
      // is the whole reason gating this write is acceptable.
      clearCheckInDraft();
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkIns(activePersonId) });
    },
    {
      offlineMessage: 'Saving a check-in needs a connection.',
      errorMessage: "Couldn't save that check-in.",
      showServerMessage: true,
    },
  );

  const discard = run(
    async (entry) => {
      await removeCheckIn(activePersonId, entry.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkIns(activePersonId) });
    },
    {
      offlineMessage: 'Removing a check-in needs a connection.',
      errorMessage: "Couldn't remove that check-in.",
    },
  );

  const nothingToSave = draft.bodyWeight === '' && draft.note.trim() === '';

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      <SectionLabel>Check-ins{person ? ` — ${person.name}` : ''}</SectionLabel>

      {mayWrite && (
        <Card size="dense" style={{ marginBottom: 24 }}>
          <label htmlFor="check-in-weight" style={fieldLabelStyle}>
            Body weight ({account?.defaultUnit || 'lb'})
          </label>
          <input
            id="check-in-weight"
            type="number"
            inputMode="decimal"
            value={draft.bodyWeight}
            onChange={(e) => setCheckInDraft({ ...draft, bodyWeight: e.target.value })}
            style={inputStyle}
          />

          <label htmlFor="check-in-body" style={{ ...fieldLabelStyle, marginTop: 'var(--space-3)' }}>
            How did it go?
          </label>
          <textarea
            id="check-in-body"
            rows={3}
            maxLength={2000}
            value={draft.note}
            onChange={(e) => setCheckInDraft({ ...draft, note: e.target.value })}
            style={{ ...inputStyle, minHeight: 80, padding: 'var(--space-2)', resize: 'vertical' }}
          />

          {mayKeepPrivate && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <input
                type="checkbox"
                checked={!draft.visibleToPerson}
                onChange={(e) => setCheckInDraft({ ...draft, visibleToPerson: !e.target.checked })}
                style={{ width: 20, height: 20 }}
              />
              {/* Phrased as what it DOES rather than as a state, so there is no ambiguity about
                  which way a ticked box points. */}
              <span style={{ fontSize: 'var(--text-sm)' }}>
                Keep this to myself &mdash; {person?.name || `this ${vocab.member}`} won&rsquo;t see it
              </span>
            </label>
          )}

          <OfflineDisabledWrap message="Saving a check-in needs a connection.">
            <Button variant="primary" fullWidth disabled={pending || nothingToSave} onClick={() => save()}>
              Save check-in
            </Button>
          </OfflineDisabledWrap>
        </Card>
      )}

      {isLoading && (
        <Card size="dense">
          <Skeleton height={18} style={{ marginBottom: 12 }} />
          <Skeleton height={18} />
        </Card>
      )}

      {isError && !entries && (
        <Card size="dense">
          <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            Couldn&rsquo;t load check-ins just now.
          </div>
        </Card>
      )}

      {entries && entries.length === 0 && (
        <EmptyState title="No check-ins yet" body="Record a weigh-in or how a session felt." />
      )}

      {entries && entries.length > 0 && (
        <Card flush>
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                borderBottom: index === entries.length - 1 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
                  {/* enteredAt is an INSTANT; formatDateLabel takes a local date string, so the
                      conversion happens here rather than being assumed. Without it a check-in
                      logged late evening in a negative-offset zone would read as the next day. */}
                  {formatDateLabel(toLocalDateStr(entry.enteredAt))}
                  {entry.authorName && ` · ${entry.authorName}`}
                  {/* ⚠️ The trainer's own signal that this one is private. Without it a trainer
                      cannot tell, while reading, which entries their client can see -- and would
                      eventually write a private observation into the visible slot. */}
                  {!entry.visibleToPerson && ' · only you'}
                </div>
                {entry.bodyWeight != null && (
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginTop: 2 }}>
                    {Number(entry.bodyWeight)} {entry.bodyWeightUnit}
                  </div>
                )}
                {entry.note && (
                  <div style={{ fontSize: 'var(--text-sm)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{entry.note}</div>
                )}
              </div>
              {(entry.authoredByYou || !isMember) && (
                <OfflineDisabledWrap message="Removing a check-in needs a connection.">
                  <IconButton
                    icon={IconClose}
                    label={`Remove check-in from ${formatDateLabel(toLocalDateStr(entry.enteredAt))}`}
                    tone="danger"
                    onClick={() => discard(entry)}
                  />
                </OfflineDisabledWrap>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

const fieldLabelStyle = {
  display: 'block',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  marginBottom: 'var(--space-1)',
};

const inputStyle = {
  width: '100%',
  minHeight: 44,
  padding: '0 var(--space-2)',
  // 16px, or iOS Safari zooms the viewport on focus (frontend-core.md).
  fontSize: 'var(--text-md)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const backButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  marginBottom: 'var(--space-3)',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};
