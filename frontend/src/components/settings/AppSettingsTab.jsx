import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';
import { updateDefaultUnit } from '../../api/account';
import { setRestTimerPreference } from '../../api/people';
import { createTag, deleteTag } from '../../api/tags';
import { downloadAllPeopleZip } from '../../api/export';
import { listImports, undoImport } from '../../api/dataImport';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import { useOfflinePin } from '../../hooks/useOfflinePin';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { pinOffline, unpinOffline } from '../../lib/offlineMode';
import Button from '../shared/Button';
import Spinner from '../shared/Spinner';
import Skeleton from '../shared/Skeleton';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import ImportDataModal from './ImportDataModal';
import { invalidateAfterImport } from '../../lib/queryClient';

// Every setting here is household-wide -- nothing is scoped to whichever person happens to be
// active. Units and the shared tag vocabulary are account-level; the rest timer is a per-person
// preference but shown for EVERY person at once so the whole household is configured from one
// screen (not one toggle that depends on who's selected).
export default function AppSettingsTab() {
  const navigate = useNavigate();
  const { account, people, refreshPeople } = useAuth();
  const { openConfirm } = useUI();
  const offlinePinned = useOfflinePin();
  // Settings writes are Tier-3. They had the online gate but no error path -- a failed unit change
  // or tag delete left the old value on screen with no indication anything went wrong.
  const { online, run } = useGatedMutation();

  const { tags, loading: tagsLoading, refetch: refetchTags } = useTags();

  const [newTagName, setNewTagName] = useState('');
  const [tagNameError, setTagNameError] = useState(false);
  const [pendingUnit, setPendingUnit] = useState(null);
  const [pendingRestPerson, setPendingRestPerson] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [imports, setImports] = useState([]);

  const queryClient = useQueryClient();

  // One request per person rather than one for the account, because listing imports is
  // person-scoped on the server and that is the property worth keeping -- an import belongs to
  // exactly one person. Household size is a handful, so the fan-out is cheap, and showing every
  // person at once matches how the rest-timer toggles already work on this screen.
  const refreshImports = useCallback(async () => {
    const results = await Promise.all(
      people.map(async (person) => {
        try {
          const batches = await listImports(person.id);
          return batches.map((batch) => ({ ...batch, personId: person.id, personName: person.name }));
        } catch {
          // A settings screen that can't reach the server still has every other setting to show,
          // so this degrades to "nothing to undo here" rather than to a broken page.
          return [];
        }
      }),
    );
    setImports(results.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [people]);

  useEffect(() => {
    refreshImports();
  }, [refreshImports]);

  const guardedUndoImport = run(
    async (batch) => {
      await undoImport(batch.personId, batch.id);
      invalidateAfterImport(queryClient, batch.personId);
      await refreshImports();
    },
    {
      offlineMessage: 'You need a connection to undo an import.',
      errorMessage: "Couldn't undo that import.",
    },
  );

  // Says what it removes AND what it leaves, rather than letting "undo" imply more than it means.
  function confirmUndoImport(batch) {
    const sets = `${batch.setCount} ${batch.setCount === 1 ? 'set' : 'sets'}`;
    const workouts = `${batch.sessionCount} ${batch.sessionCount === 1 ? 'workout' : 'workouts'}`;
    openConfirm(
      `Remove the ${sets} and ${workouts} this import added to ${batch.personName}'s history? `
        + 'Exercises, tags and notes it created stay.',
      () => guardedUndoImport(batch),
    );
  }

  async function handleRestTimerToggle(personId, value) {
    setPendingRestPerson(personId);
    try {
      await setRestTimerPreference(personId, value);
      await refreshPeople();
    } finally {
      setPendingRestPerson(null);
    }
  }

  async function handleUnitSelect(unit) {
    if (unit === account.defaultUnit || pendingUnit) return;
    setPendingUnit(unit);
    try {
      await updateDefaultUnit(unit);
      await refreshPeople();
    } finally {
      setPendingUnit(null);
    }
  }

  async function handleAddTag(name) {
    const trimmed = (name ?? newTagName).trim();
    if (!trimmed) {
      setTagNameError(true);
      return;
    }
    await createTag(trimmed);
    setNewTagName('');
    await refetchTags();
  }

  async function handleDeleteTag(tag) {
    await deleteTag(tag.id);
    await refetchTags();
  }

  const guardedUnitSelect = run(handleUnitSelect, { offlineMessage: 'Changing units needs a connection.' });
  const guardedRestTimerToggle = run(handleRestTimerToggle, { offlineMessage: 'Changing this needs a connection.' });
  const guardedAddTag = run(handleAddTag, { offlineMessage: 'Adding a tag needs a connection.' });
  const guardedDeleteTag = run(handleDeleteTag, { offlineMessage: 'Deleting a tag needs a connection.' });

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      <div style={sectionLabelStyle}>Units</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
          Default unit for new sets entered from now on. Sets already logged keep the unit they were recorded in &mdash; changing this never rewrites past numbers.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--color-subtle-bg)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', maxWidth: 220 }}>
          {['lb', 'kg'].map((unit) => {
            const active = account?.defaultUnit === unit;
            const loading = pendingUnit === unit;
            const textColor = active ? 'var(--color-accent)' : 'var(--color-muted)';
            return (
              <button
                key={unit}
                onClick={() => guardedUnitSelect(unit)}
                disabled={!!pendingUnit || !online}
                title={online ? undefined : 'Changing units needs a connection.'}
                style={{
                  flex: 1,
                  minHeight: 40,
                  padding: 'var(--space-2) 0',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: online ? 'pointer' : 'not-allowed',
                  background: active ? 'var(--color-surface)' : 'transparent',
                  color: textColor,
                  boxShadow: active ? 'var(--shadow-1)' : 'none',
                  opacity: online ? 1 : 0.5,
                  position: 'relative',
                }}
              >
                <span style={{ visibility: loading ? 'hidden' : 'visible' }}>{unit}</span>
                {loading && (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner size={14} color={textColor} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div style={sectionLabelStyle}>Offline Mode</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
          Turn this on if you&rsquo;re somewhere with a bad connection. The app stops trying to reach
          the server &mdash; everything you log is saved on this device and syncs automatically once
          you turn it back off.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--color-subtle-bg)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', maxWidth: 220 }}>
          {[
            { value: false, label: 'Off' },
            { value: true, label: 'On' },
          ].map(({ value, label }) => {
            const active = offlinePinned === value;
            return (
              <button
                key={label}
                onClick={() => (value ? pinOffline() : unpinOffline())}
                aria-label={`Offline mode ${label}`}
                style={{
                  flex: 1,
                  minHeight: 40,
                  padding: 'var(--space-2) 0',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: 'pointer',
                  background: active ? 'var(--color-surface)' : 'transparent',
                  color: active ? 'var(--color-accent-text)' : 'var(--color-muted)',
                  boxShadow: active ? 'var(--shadow-1)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={sectionLabelStyle}>Rest Timer</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 16 }}>
          Show a countdown after logging a set, per person. Rest time between sets is always recorded
          for Trends either way.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {people.map((person) => {
            const personEnabled = person.restTimerEnabled ?? true;
            const busy = pendingRestPerson === person.id;
            return (
              <div key={person.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{person.name}</div>
                <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--color-subtle-bg)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', width: 160 }}>
                  {[
                    { value: true, label: 'On' },
                    { value: false, label: 'Off' },
                  ].map(({ value, label }) => {
                    const active = personEnabled === value;
                    return (
                      <button
                        key={label}
                        onClick={() => guardedRestTimerToggle(person.id, value)}
                        disabled={busy || !online}
                        title={online ? undefined : 'Changing this needs a connection.'}
                        aria-label={`Rest timer ${label} for ${person.name}`}
                        style={{
                          flex: 1,
                          padding: '9px 0',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--weight-semibold)',
                          cursor: busy || !online ? 'default' : 'pointer',
                          background: active ? 'var(--color-surface)' : 'transparent',
                          color: active ? 'var(--color-accent-text)' : 'var(--color-muted)',
                          boxShadow: active ? 'var(--shadow-1)' : 'none',
                          opacity: online ? 1 : 0.5,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={sectionLabelStyle}>Tags</div>
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
        Shared tags anyone on this account can apply to exercises from an exercise&rsquo;s Customize screen.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {tagsLoading && [88, 64, 104, 72].map((w, i) => <Skeleton key={i} width={w} height={34} radius={999} />)}
        {!tagsLoading &&
          tags.map((t) => (
            <div key={t.id} style={categoryChipStyle}>
              {t.name}
              <OfflineDisabledWrap message="Deleting a tag needs a connection.">
                <button
                  onClick={() => openConfirm(`Delete tag "${t.name}"? It will be removed from every exercise it's applied to.`, () => guardedDeleteTag(t))}
                  style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 15, cursor: 'pointer' }}
                >
                  &times;
                </button>
              </OfflineDisabledWrap>
            </div>
          ))}
        {!tagsLoading && tags.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-faint)' }}>No tags yet.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: tagNameError ? 6 : 24 }}>
        <input
          value={newTagName}
          onChange={(e) => {
            setNewTagName(e.target.value);
            if (tagNameError) setTagNameError(false);
          }}
          placeholder="New tag name"
          // 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
          style={{
            flex: 1,
            padding: '12px 14px',
            border: `1px solid ${tagNameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 10,
            fontSize: 16,
          }}
        />
        <OfflineDisabledWrap message="Adding a tag needs a connection.">
          <Button onClick={() => guardedAddTag()} style={{ padding: '12px 20px', background: 'var(--color-dark)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Add
          </Button>
        </OfflineDisabledWrap>
      </div>
      {tagNameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 18 }}>Enter a tag name.</div>
      )}

      <div style={sectionLabelStyle}>Data</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
          Download a CSV of every set ever logged, for every person on this account &mdash; one file per person, zipped together.
        </div>
        <OfflineDisabledWrap message="Exporting needs a connection.">
          <Button onClick={downloadAllPeopleZip} style={{ width: '100%', padding: 14, background: 'var(--color-subtle-bg)', color: 'var(--color-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Export all data
          </Button>
        </OfflineDisabledWrap>

        <div style={{ fontSize: 14, color: 'var(--color-muted)', margin: '18px 0 12px' }}>
          Bring workouts in from a CSV or Excel file &mdash; one this app exported, or a spreadsheet of your
          own. You choose who it belongs to, and see exactly what will be added before anything is saved.
        </div>
        <OfflineDisabledWrap message="Importing needs a connection.">
          <Button onClick={() => setShowImportModal(true)} style={{ width: '100%', padding: 14, background: 'var(--color-subtle-bg)', color: 'var(--color-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Import data
          </Button>
        </OfflineDisabledWrap>

        {imports.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', marginBottom: 10 }}>
              Recent imports
            </div>
            {imports.map((batch) => (
              <div key={batch.id} style={importRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batch.filename || 'Imported file'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                    {batch.personName} &middot; {formatDateLabel(toLocalDateStr(batch.createdAt))} &middot;{' '}
                    {batch.setCount} {batch.setCount === 1 ? 'set' : 'sets'}
                    {batch.undoneAt ? ' \u00b7 undone' : ''}
                  </div>
                </div>
                {!batch.undoneAt && (
                  <OfflineDisabledWrap message="Undoing an import needs a connection.">
                    <Button onClick={() => confirmUndoImport(batch)} variant="ghost" size="sm">
                      Undo
                    </Button>
                  </OfflineDisabledWrap>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showImportModal && (
        <ImportDataModal
          onClose={() => {
            setShowImportModal(false);
            refreshImports();
          }}
        />
      )}
    </div>
  );
}

const importRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 0',
};

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

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 12,
};

const categoryChipStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 8px 8px 14px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 'var(--weight-semibold)',
};
