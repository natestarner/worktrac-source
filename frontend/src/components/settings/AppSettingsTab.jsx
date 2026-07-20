import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';
import { updateDefaultUnit } from '../../api/account';
import { setRestTimerPreference } from '../../api/people';
import { createTag, deleteTag } from '../../api/tags';
import { downloadAllPeopleZip } from '../../api/export';
import Button from '../shared/Button';
import Spinner from '../shared/Spinner';
import Skeleton from '../shared/Skeleton';

// Every setting here is household-wide -- nothing is scoped to whichever person happens to be
// active. Units and the shared tag vocabulary are account-level; the rest timer is a per-person
// preference but shown for EVERY person at once so the whole household is configured from one
// screen (not one toggle that depends on who's selected).
export default function AppSettingsTab() {
  const navigate = useNavigate();
  const { account, people, refreshPeople } = useAuth();
  const { openConfirm } = useUI();

  const { tags, loading: tagsLoading, refetch: refetchTags } = useTags();

  const [newTagName, setNewTagName] = useState('');
  const [tagNameError, setTagNameError] = useState(false);
  const [pendingUnit, setPendingUnit] = useState(null);
  const [pendingRestPerson, setPendingRestPerson] = useState(null);

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
        <div style={{ display: 'flex', gap: 4, background: 'var(--color-subtle-bg)', borderRadius: 12, padding: 4, maxWidth: 220 }}>
          {['lb', 'kg'].map((unit) => {
            const active = account?.defaultUnit === unit;
            const loading = pendingUnit === unit;
            const textColor = active ? 'var(--color-accent)' : 'var(--color-muted)';
            return (
              <button
                key={unit}
                onClick={() => handleUnitSelect(unit)}
                disabled={!!pendingUnit}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  border: 'none',
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: active ? 'var(--color-surface)' : 'transparent',
                  color: textColor,
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
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
                <div style={{ display: 'flex', gap: 4, background: 'var(--color-subtle-bg)', borderRadius: 12, padding: 4, width: 160 }}>
                  {[
                    { value: true, label: 'On' },
                    { value: false, label: 'Off' },
                  ].map(({ value, label }) => {
                    const active = personEnabled === value;
                    return (
                      <button
                        key={label}
                        onClick={() => handleRestTimerToggle(person.id, value)}
                        disabled={busy}
                        aria-label={`Rest timer ${label} for ${person.name}`}
                        style={{
                          flex: 1,
                          padding: '9px 0',
                          border: 'none',
                          borderRadius: 9,
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: busy ? 'default' : 'pointer',
                          background: active ? 'var(--color-surface)' : 'transparent',
                          color: active ? 'var(--color-accent)' : 'var(--color-muted)',
                          boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
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
              <button
                onClick={() => openConfirm(`Delete tag "${t.name}"? It will be removed from every exercise it's applied to.`, () => handleDeleteTag(t))}
                style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 15, cursor: 'pointer' }}
              >
                &times;
              </button>
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
        <Button onClick={() => handleAddTag()} style={{ padding: '12px 20px', background: 'var(--color-dark)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Add
        </Button>
      </div>
      {tagNameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 18 }}>Enter a tag name.</div>
      )}

      <div style={sectionLabelStyle}>Data</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
          Download a CSV of every set ever logged, for every person on this account &mdash; one file per person, zipped together.
        </div>
        <Button onClick={downloadAllPeopleZip} style={{ width: '100%', padding: 14, background: 'var(--color-subtle-bg)', color: 'var(--color-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Export all data
        </Button>
      </div>
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 0 16px 0',
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
  fontWeight: 600,
};
