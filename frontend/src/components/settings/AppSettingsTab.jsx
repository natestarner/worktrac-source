import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';
import { updateDefaultUnit } from '../../api/account';
import { createTag, deleteTag } from '../../api/tags';
import { downloadAllPeopleZip } from '../../api/export';
import Button from '../shared/Button';
import Spinner from '../shared/Spinner';
import Skeleton from '../shared/Skeleton';

// Exercises are managed on the exercise screen itself now (favorite star + the gear "Customize
// this exercise" modal, which is also where you rename/delete your own exercises). Settings
// only keeps account-level bits: units, the household's shared tag vocabulary, and data export.
export default function AppSettingsTab() {
  const navigate = useNavigate();
  const { account, refreshPeople } = useAuth();
  const { openConfirm } = useUI();

  const { tags, loading: tagsLoading, refetch: refetchTags } = useTags();

  const [newTagName, setNewTagName] = useState('');
  const [tagNameError, setTagNameError] = useState(false);
  const [pendingUnit, setPendingUnit] = useState(null);

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
          style={{
            flex: 1,
            padding: '12px 14px',
            border: `1px solid ${tagNameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 10,
            fontSize: 14,
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
