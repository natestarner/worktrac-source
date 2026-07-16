import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { usePersonCategories } from '../../hooks/usePersonCategories';
import { updateDefaultUnit } from '../../api/account';
import { createPersonCategory, deletePersonCategory, listCategoryRecommendations } from '../../api/personCategories';
import { downloadAllPeopleZip } from '../../api/export';
import Button from '../shared/Button';
import Spinner from '../shared/Spinner';
import Skeleton from '../shared/Skeleton';

// Exercises are managed on the exercise screen itself now (favorite star + the gear "Customize
// this exercise" modal, which is also where you rename/delete your own exercises). Settings
// only keeps account/person-level bits: units, the per-person category list, and data export.
export default function AppSettingsTab() {
  const navigate = useNavigate();
  const { account, people, refreshPeople } = useAuth();
  const { activePersonId } = useAppState();
  const { openConfirm } = useUI();

  const activePersonName = people?.find((p) => p.id === activePersonId)?.name;

  const {
    categories: personCategories,
    loading: personCategoriesLoading,
    refetch: refetchPersonCategories,
  } = usePersonCategories(activePersonId);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryNameError, setCategoryNameError] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [pendingUnit, setPendingUnit] = useState(null);

  useEffect(() => {
    if (!activePersonId) return;
    listCategoryRecommendations(activePersonId).then(setRecommendations).catch(() => setRecommendations([]));
  }, [activePersonId, personCategories]);

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

  async function handleAddCategory(name) {
    const trimmed = (name ?? newCategoryName).trim();
    if (!trimmed) {
      setCategoryNameError(true);
      return;
    }
    await createPersonCategory(activePersonId, trimmed);
    setNewCategoryName('');
    await refetchPersonCategories();
  }

  async function handleDeleteCategory(cat) {
    await deletePersonCategory(activePersonId, cat.id);
    await refetchPersonCategories();
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

      <div style={sectionLabelStyle}>
        {activePersonName ? `${activePersonName}'s categories` : 'Your categories'}
      </div>
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 12 }}>
        Categories you can file exercises under from an exercise&rsquo;s Customize screen.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {personCategoriesLoading && [88, 64, 104, 72].map((w, i) => <Skeleton key={i} width={w} height={34} radius={999} />)}
        {!personCategoriesLoading &&
          personCategories.map((c) => (
            <div key={c.id} style={categoryChipStyle}>
              {c.name}
              <button
                onClick={() => openConfirm(`Delete category "${c.name}"? Exercises filed under it stay in your list, just uncategorized.`, () => handleDeleteCategory(c))}
                style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 15, cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
          ))}
        {!personCategoriesLoading && personCategories.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-faint)' }}>No categories yet.</div>
        )}
      </div>

      {recommendations.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Suggestions
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {recommendations.map((name) => (
              <button key={name} onClick={() => handleAddCategory(name)} style={{ ...categoryChipStyle, borderStyle: 'dashed', cursor: 'pointer', color: 'var(--color-muted)' }}>
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: categoryNameError ? 6 : 24 }}>
        <input
          value={newCategoryName}
          onChange={(e) => {
            setNewCategoryName(e.target.value);
            if (categoryNameError) setCategoryNameError(false);
          }}
          placeholder="New category name"
          style={{
            flex: 1,
            padding: '12px 14px',
            border: `1px solid ${categoryNameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 10,
            fontSize: 14,
          }}
        />
        <Button onClick={() => handleAddCategory()} style={{ padding: '12px 20px', background: 'var(--color-dark)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Add
        </Button>
      </div>
      {categoryNameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 18 }}>Enter a category name.</div>
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
