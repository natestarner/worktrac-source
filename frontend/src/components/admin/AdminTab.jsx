import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { useCategories } from '../../hooks/useCategories';
import { updateDefaultUnit } from '../../api/account';
import { removeExercise } from '../../api/exercises';
import { addCategory, removeCategory } from '../../api/categories';
import { removePerson } from '../../api/people';
import AddEditExerciseModal from './AddEditExerciseModal';
import Button from '../shared/Button';
import Spinner from '../shared/Spinner';
import Skeleton from '../shared/Skeleton';

export default function AdminTab() {
  const { account, people, refreshPeople } = useAuth();
  const { openConfirm } = useUI();
  const { exercises, loading: exercisesLoading, refetch: refetchExercises } = useExercises();
  const { categories, loading: categoriesLoading, refetch: refetchCategories } = useCategories();
  const [modalExercise, setModalExercise] = useState(undefined); // undefined = closed, null = create
  const [newCategoryName, setNewCategoryName] = useState('');
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

  async function handleDeleteExercise(ex) {
    await removeExercise(ex.id);
    refetchExercises();
  }

  async function handleAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    await addCategory(trimmed);
    setNewCategoryName('');
    refetchCategories();
  }

  async function handleDeleteCategory(cat) {
    await removeCategory(cat.id);
    refetchCategories();
  }

  async function handleRemovePerson(person) {
    await removePerson(person.id);
    refreshPeople();
  }

  return (
    <div>
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

      <div style={sectionLabelStyle}>Exercise library</div>
      <button onClick={() => setModalExercise(null)} style={addButtonStyle}>
        + Add exercise
      </button>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px', marginBottom: 24 }}>
        {exercisesLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < 3 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
              <div>
                <Skeleton width={130} height={15} style={{ marginBottom: 6 }} />
                <Skeleton width={80} height={12} />
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                <Skeleton width={28} height={13} />
                <Skeleton width={44} height={13} />
              </div>
            </div>
          ))}
        {!exercisesLoading && exercises.map((ex, i) => (
          <div key={ex.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < exercises.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{ex.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                {ex.categoryName}
                {ex.isGlobal && ' · System'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <button onClick={() => setModalExercise(ex)} style={editLinkStyle}>
                Edit
              </button>
              <button
                onClick={() =>
                  openConfirm(
                    ex.isGlobal
                      ? `Delete "${ex.name}"? This only removes it from your library -- other households keep it, and your own already-logged sets are kept but it will disappear from your picker.`
                      : `Delete "${ex.name}"? Already-logged sets for it are kept, but it will disappear from the picker.`,
                    () => handleDeleteExercise(ex),
                  )
                }
                style={deleteLinkStyle}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={sectionLabelStyle}>Categories</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {categoriesLoading &&
          [88, 64, 104, 72].map((w, i) => <Skeleton key={i} width={w} height={34} radius={999} />)}
        {!categoriesLoading && categories.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 8px 8px 14px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {c.name}
            {!c.isGlobal && (
              <button
                onClick={() => openConfirm(`Delete category "${c.name}"?`, () => handleDeleteCategory(c))}
                style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 15, cursor: 'pointer' }}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="New category name"
          style={{ flex: 1, padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 14 }}
        />
        <Button onClick={handleAddCategory} style={{ padding: '12px 20px', background: 'var(--color-dark)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Add
        </Button>
      </div>

      <div style={sectionLabelStyle}>People</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
        {people.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < people.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
              {p.isPrimary && (
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-muted)', background: 'var(--color-subtle-bg)', padding: '3px 8px', borderRadius: 999 }}>
                  PRIMARY
                </span>
              )}
            </div>
            {!p.isPrimary && (
              <button
                onClick={() => openConfirm(`Remove ${p.name}? This deletes all of their sessions, sets, routines, and setup values.`, () => handleRemovePerson(p))}
                style={deleteLinkStyle}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {modalExercise !== undefined && (
        <AddEditExerciseModal
          exercise={modalExercise}
          categories={categories}
          onClose={() => setModalExercise(undefined)}
          onSaved={() => {
            setModalExercise(undefined);
            refetchExercises();
          }}
        />
      )}
    </div>
  );
}

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 12,
};

const addButtonStyle = {
  width: '100%',
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  marginBottom: 14,
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
